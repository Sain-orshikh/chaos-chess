import { v2 as cloudinary } from "cloudinary";

export async function uploadProfileImage(buffer, userId) {
    const result = await cloudinary.uploader.upload(`data:image/webp;base64,${buffer.toString("base64")}`, {
        public_id: `chaos-chess/avatars/${userId}`,
        resource_type: "image",
        allowed_formats: ["webp"],
        overwrite: true,
        invalidate: true,
    });
    return result.secure_url;
}
