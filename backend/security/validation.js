import sharp from "sharp";

export class ValidationError extends Error {}

export function fields(body, allowed) {
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.getPrototypeOf(body) !== Object.prototype ||
        Object.keys(body).some((key) => !allowed.includes(key))) {
        throw new ValidationError("Invalid request fields.");
    }
}

export function username(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_]{3,24}$/.test(value)) {
        throw new ValidationError("Use 3–24 letters, numbers, or underscores for your username.");
    }
    return value;
}

export function password(value) {
    if (typeof value !== "string" || value.length < 6 || Buffer.byteLength(value, "utf8") > 72 || /[\x00-\x1f\x7f]/.test(value)) {
        throw new ValidationError("Use at least 6 characters and no more than 72 bytes for your password.");
    }
    return value;
}

const imageTypes = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export async function profileImage(value) {
    fields(value, ["name", "type", "data"]);
    const { name, type, data } = value;
    const extension = typeof name === "string" ? name.split(".").pop()?.toLowerCase() : undefined;
    if (!extension || !Object.hasOwn(imageTypes, extension) || imageTypes[extension] !== type ||
        typeof name !== "string" || name.length > 200 || /[\x00-\x1f]/.test(name) ||
        typeof data !== "string" || data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 40) {
        throw new ValidationError("Choose a JPG, PNG, WebP, or GIF image up to 2 MB.");
    }
    const prefix = `data:${type};base64,`;
    if (!data.startsWith(prefix)) throw new ValidationError("The image type does not match its contents.");
    const encoded = data.slice(prefix.length);
    if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
        throw new ValidationError("The image data is invalid.");
    }
    const buffer = Buffer.from(encoded, "base64");
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES || buffer.toString("base64") !== encoded) {
        throw new ValidationError("Choose an image up to 2 MB.");
    }
    try {
        const image = sharp(buffer, { limitInputPixels: 16_000_000, failOn: "warning" });
        const metadata = await image.metadata();
        const expectedFormat = extension === "jpg" ? "jpeg" : extension;
        if (metadata.format !== expectedFormat || !metadata.width || !metadata.height || metadata.format === "svg") {
            throw new Error("Image format mismatch");
        }
        // Decode and re-encode: uploaded markup, metadata, and original file bytes are never served.
        return await image.rotate().resize(512, 512, { fit: "cover", withoutEnlargement: true }).webp().toBuffer();
    } catch {
        throw new ValidationError("The file is not a valid JPG, PNG, WebP, or GIF image.");
    }
}

export function validationResponse(error, res) {
    if (error instanceof ValidationError) {
        res.status(400).json({ error: error.message });
        return true;
    }
    return false;
}
