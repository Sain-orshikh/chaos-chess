import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            unique: true,
            required: true,
        },
        password: {
            type: String,
            required: true,
            minLength: 6,
        },
        profileImg: {
            type: String,
            default: "",
        },
        elo: {
            type: Number,
            default: 0,
        },
        matches: {
            type: Number,
            default: 0,
        },
        wins: {
            type: Number,
            default: 0,
        }
    },
    { timestamps: true }
);

const User = mongoose.model("User", userSchema);

export default User;