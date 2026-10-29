export type User = { _id: string; username: string; profileImg: string; elo: number; matches?: number; wins?: number };
export type ImageUpload = { name: string; type: string; data: string };

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ?? AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError("Account service is unavailable. You can still play anonymously.", 503);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.error || "Account service is unavailable. Please try again.", response.status);
  return data as T;
}

export async function readProfileImage(file: File): Promise<ImageUpload> {
  const types: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!Object.hasOwn(types, extension) || types[extension] !== file.type || !file.size || file.size > 2 * 1024 * 1024) {
    throw new Error("Choose a JPG, PNG, WebP, or GIF image up to 2 MB.");
  }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the image. Please choose another file."));
    reader.readAsDataURL(file);
  });
  return { name: file.name, type: file.type, data };
}
