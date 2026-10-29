import bcrypt from 'bcryptjs';
import {v2 as cloudinary} from "cloudinary";

import User from "../models/user.model.js";

export const getUserProfile = async (req,res) => {
    const {username} = req.params;

    try{
        const user = await User.findOne({username}).select("-password");
        if(!user) return res.status(400).json({error: "User not found"});
        res.status(200).json(user);
    }
    catch(error){
        console.log("Error in getUserProfile:",error.message);
        res.status(500).json({error: error.message});
    }
};

export const updateUser = async (req, res) => {
	const { username, currentPassword, newPassword } = req.body;
	let { profileImg } = req.body;

	const userId = req.user._id;

	try {
		
		let user = await User.findById(userId);
		const usernameregex = await User.findOne({username});
		
		if(usernameregex && usernameregex.username !== user.username) return res.status(400).json({error: "Username is already taken"});

		if (!user) return res.status(404).json({ message: "User not found" });

		if ((!newPassword && currentPassword) || (!currentPassword && newPassword)) {
			return res.status(400).json({ error: "Please provide both current password and new password" });
		}

		if (currentPassword && newPassword) {
			const isMatch = await bcrypt.compare(currentPassword, user.password);
			if (!isMatch) return res.status(400).json({ error: "Current password is incorrect" });
			if (newPassword.length < 6) {
				return res.status(400).json({ error: "Password must be at least 6 characters long" });
			}

			const salt = await bcrypt.genSalt(10);
			user.password = await bcrypt.hash(newPassword, salt);
		}

		if (profileImg) {
			if (user.profileImg) {
				await cloudinary.uploader.destroy(user.profileImg.split("/").pop().split(".")[0]);
			}

			const uploadedResponse = await cloudinary.uploader.upload(profileImg);
			profileImg = uploadedResponse.secure_url;
		}

		user.username = username || user.username;
		user.profileImg = profileImg || user.profileImg;

		user = await user.save();

		// password should be null in response
		user.password = null;

		return res.status(200).json(user);
	} catch (error) {
		console.log("Error in updateUser: ", error.message);
		res.status(500).json({ error: error.message });
	}
};
