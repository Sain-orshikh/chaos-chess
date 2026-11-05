"""Independent Classic referee. Requires python-chess; no app dependencies changed.

python3 benchmarks/engine-match.py --stockfish /path/to/stockfish --games 8
Each adjacent game pair shares an opening, seed and opponent with colors swapped.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import select
import statistics
import subprocess
import time

import chess
import chess.pgn

ROOT = Path(__file__).resolve().parent.parent
OPENINGS = [
    ("Open game", "e2e4 e7e5 g1f3 b8c6"),
    ("Queen's pawn", "d2d4 d7d5 c2c4 e7e6"),
    ("Sicilian", "e2e4 c7c5 g1f3 d7d6"),
    ("English", "c2c4 e7e5 b1c3 g8f6"),
]


class UciEngine:
    """Small blocking bridge; preserves full move history in position commands."""
    def __init__(self, executable):
        self.process = subprocess.Popen([executable], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        self.buffer = b''
        self.send('uci')
        lines = self.until('uciok')
        self.id = {line.split(' ', 2)[1]: line.split(' ', 2)[2] for line in lines if line.startswith('id ')}

    def send(self, command):
        self.process.stdin.write((command+'\n').encode())
        self.process.stdin.flush()

    def until(self, prefix):
        deadline = time.monotonic() + 30
        lines = []
        while True:
            if b'\n' in self.buffer:
                raw, self.buffer = self.buffer.split(b'\n', 1)
                line = raw.decode().strip()
                lines.append(line)
                if line.startswith(prefix):
                    return lines
                continue
            remaining = deadline-time.monotonic()
            if remaining <= 0 or not select.select([self.process.stdout], [], [], remaining)[0]:
                raise TimeoutError(f'Stockfish did not respond with {prefix}')
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                raise RuntimeError('Stockfish exited: '+str(lines[-5:]))
            self.buffer += chunk

    def configure(self, options):
        for name, value in options.items():
            self.send(f'setoption name {name} value {str(value).lower()}')
        self.send('isready')
        self.until('readyok')

    def new_game(self):
        self.send('ucinewgame')
        self.send('isready')
        self.until('readyok')

    def play(self, board, time_ms):
        self.send('position startpos moves '+' '.join(move.uci() for move in board.move_stack))
        self.send(f'go movetime {time_ms}')
        return chess.Move.from_uci(self.until('bestmove')[-1].split()[1])

    def quit(self):
        self.send('quit')
        self.process.wait(timeout=5)


def summarize(games):
    groups = []
    for elo in sorted({game['opponentElo'] for game in games}):
        valid = [game for game in games if game['opponentElo'] == elo and game['score'] is not None]
        n = len(valid)
        if not n:
            continue
        points = sum(game['score'] for game in valid)
        p = points / n
        # Wilson interval for fractional game scores is descriptive, not a paired-game CI.
        z = 1.96
        center = (p + z*z/(2*n)) / (1 + z*z/n)
        radius = z * math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / (1 + z*z/n)
        rating = lambda q: None if q <= 0 or q >= 1 else round(elo + 400*math.log10(q/(1-q)))
        groups.append(dict(opponentElo=elo, games=n, wins=sum(g['score'] == 1 for g in valid),
            draws=sum(g['score'] == .5 for g in valid), losses=sum(g['score'] == 0 for g in valid),
            scorePercent=round(100*p, 1), relativeRating=rating(p),
            descriptive95Rating=[rating(max(0, center-radius)), rating(min(1, center+radius))]))
    return groups


def run(args):
    args.output.parent.mkdir(parents=True, exist_ok=True)
    report = dict(started=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        environment=dict(platform=platform.platform(), cpu=platform.processor(), python=platform.python_version()),
        settings=dict(rookeTimeMs=args.time_ms, stockfishTimeMs=args.time_ms, threads=1, hashMB=16,
            maxPlies=args.max_plies, ponder=False, rules='Classic', repetition='threefold adjudication',
            openingPlies=4, colors='paired and swapped', evaluationSeed='20261105 + pair index'),
        sourceHashes={str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (ROOT/'src/components').rglob('*.ts')}, games=[])
    sf = UciEngine(args.stockfish)
    report['opponent'] = sf.id
    sf.configure({'Threads': 1, 'Hash': 16, 'UCI_LimitStrength': True})
    worker = subprocess.Popen(['node', str(ROOT/'benchmarks/rooke-match-worker.mjs')],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(str(args.output)+'.stderr', 'w'), text=True, bufsize=1)
    try:
        for index in range(args.games):
            pair = index // 2
            elo = args.elos[pair % len(args.elos)]
            opening_name, opening = OPENINGS[(pair // len(args.elos)) % len(OPENINGS)]
            rooke_color = chess.WHITE if index % 2 == 0 else chess.BLACK
            seed = 20261105 + pair
            sf.configure({'UCI_Elo': elo})
            sf.new_game()
            board = chess.Board()
            game = chess.pgn.Game()
            game.headers.update(Event='Rooke Classic strength screening', White='Rooke' if rooke_color else f'Stockfish {elo}',
                Black=f'Stockfish {elo}' if rooke_color else 'Rooke', Round=str(index+1), TimeControl=f'{args.time_ms/1000:g}/move')
            node = game
            for code in opening.split():
                move = chess.Move.from_uci(code)
                board.push(move)
                node = node.add_variation(move)
            record = dict(number=index+1, opponentElo=elo, rookeColor='white' if rooke_color else 'black', opening=opening_name,
                seed=seed, moves=[], score=None, result='*', termination='max-plies')
            started = time.monotonic()
            print(f'START {index+1}/{args.games}: {opening_name}, Rooke {record["rookeColor"]}, SF {elo}', flush=True)
            while board.ply() < args.max_plies:
                outcome = board.outcome(claim_draw=False)
                if outcome or board.is_repetition(3):
                    record['result'] = outcome.result() if outcome else '1/2-1/2'
                    record['termination'] = outcome.termination.name if outcome else 'THREEFOLD_ADJUDICATION'
                    record['score'] = .5 if not outcome or outcome.winner is None else int(outcome.winner == rooke_color)
                    break
                if board.turn == rooke_color:
                    worker.stdin.write(json.dumps(dict(fen=board.fen(en_passant='fen'), seed=seed, timeMs=args.time_ms))+'\n')
                    worker.stdin.flush()
                    if not select.select([worker.stdout], [], [], 30)[0]:
                        raise TimeoutError('Rooke worker exceeded 30 seconds')
                    data = json.loads(worker.stdout.readline())
                    if 'error' in data:
                        raise RuntimeError(data['error'])
                    legal = {move.uci() for move in board.legal_moves}
                    if set(data['legal']) != legal:
                        raise AssertionError(f'Generator disagreement at {board.fen()}: app-only={set(data["legal"])-legal}, referee-only={legal-set(data["legal"])}')
                    move = chess.Move.from_uci(data['move'])
                    record['moves'].append(dict(ply=board.ply()+1, **{k:v for k,v in data.items() if k != 'legal'}))
                else:
                    move = sf.play(board, args.time_ms)
                if move not in board.legal_moves:
                    raise AssertionError(f'Illegal move {move} at {board.fen()}')
                board.push(move)
                node = node.add_variation(move)
                if board.ply() % 20 == 0:
                    print(f'  game {index+1}: ply {board.ply()}, {time.monotonic()-started:.0f}s', flush=True)
            record.update(plies=board.ply(), seconds=round(time.monotonic()-started, 2), finalFen=board.fen())
            game.headers['Result'] = record['result']
            game.headers['Termination'] = record['termination']
            with args.output.with_suffix('.pgn').open('a') as f:
                print(game, file=f, end='\n\n')
            report['games'].append(record)
            report['summary'] = summarize(report['games'])
            args.output.write_text(json.dumps(report, indent=2)+'\n')
            print(f'END {index+1}: {record["result"]}, {record["termination"]}; {report["summary"]}', flush=True)
    finally:
        worker.terminate()
        worker.wait(timeout=5)
        sf.quit()
    report['finished'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    args.output.write_text(json.dumps(report, indent=2)+'\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stockfish', required=True)
    parser.add_argument('--games', type=int, default=8)
    parser.add_argument('--time-ms', type=int, default=3000)
    parser.add_argument('--elos', type=int, nargs='+', default=[1320, 1520])
    parser.add_argument('--max-plies', type=int, default=300)
    parser.add_argument('--output', type=Path, default=ROOT/'benchmarks/rooke-classic-matches.json')
    args = parser.parse_args()
    if args.games < 2 or args.games % 2 or not 100 <= args.time_ms <= 10000:
        parser.error('Use a positive even game count and 100–10000 ms per move.')
    run(args)
