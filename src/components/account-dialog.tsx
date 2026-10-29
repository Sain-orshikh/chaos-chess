"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Icon from "./icon";
import { useAuth } from "./auth-provider";
import { api, readProfileImage, type User } from "@/lib/api";

export type AccountAction = "login" | "signup" | "password" | "picture";

export default function AccountDialog({ action, onClose }: { action: AccountAction; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { user, setUser } = useAuth();
  const [mode, setMode] = useState(action);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const title = mode === "login" ? "Sign in" : mode === "signup" ? "Create account" : mode === "picture" ? "Change profile picture" : "Change password";
  useEffect(() => { dialog.current?.showModal(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError(""); setSuccess(""); setBusy(true);
    try {
      let result: User;
      if (mode === "login" || mode === "signup") {
        result = await api<User>(`/auth/${mode}`, { username: form.get("username"), password: form.get("password") });
      } else if (mode === "password") {
        if (form.get("newPassword") !== form.get("confirmPassword")) throw new Error("New passwords do not match.");
        result = await api<User>("/user/update", { currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") });
      } else {
        const file = form.get("picture");
        if (!(file instanceof File)) throw new Error("Choose a profile picture.");
        result = await api<User>("/user/update", { profileImg: await readProfileImage(file) });
      }
      setUser(result);
      if (mode === "password") { setSuccess("Password changed."); formElement.reset(); }
      else onClose();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save your changes."); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="account-dialog" aria-labelledby="account-title" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div className="dialog-heading"><h2 id="account-title">{title}</h2><button className="icon-button" aria-label="Close account settings" onClick={onClose} disabled={busy}><Icon name="close" /></button></div>
    {(mode === "login" || mode === "signup") && <p className="dialog-note">You can also play anonymously. Local games are always unrated.</p>}
    {mode === "picture" && <p className="dialog-note">JPG, PNG, WebP, or GIF. Up to 2 MB.</p>}
    <form onSubmit={submit}>
      {(mode === "login" || mode === "signup") && <>
        <label>Username<input name="username" autoComplete="username" pattern="[A-Za-z0-9_]{3,24}" minLength={3} maxLength={24} title="3–24 letters, numbers, or underscores" required disabled={busy} /></label>
        <label>Password<input name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={6} maxLength={72} required disabled={busy} /></label>
      </>}
      {mode === "password" && <>
        <input hidden readOnly name="username" autoComplete="username" value={user?.username ?? ""} />
        <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={72} disabled={busy} /></label>
        <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={6} maxLength={72} required disabled={busy} /></label>
        <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={6} maxLength={72} required disabled={busy} /></label>
      </>}
      {mode === "picture" && <label>Profile picture<input name="picture" type="file" accept=".jpg,.jpeg,.png,.webp,.gif" required disabled={busy} /></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {success && <p className="form-success" role="status">{success}</p>}
      <button className="primary-button" disabled={busy} type="submit">{busy ? "Please wait…" : title}</button>
    </form>
    {(mode === "login" || mode === "signup") && <button className="text-button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }} disabled={busy}>{mode === "login" ? "Create an account" : "Already have an account? Sign in"}</button>}
  </dialog>;
}
