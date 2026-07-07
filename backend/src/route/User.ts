import express from 'express';
import { signin_val, signup_val } from '../validation/User_Val';
import { prisma } from '../db/db.ts';
import bcrypt from 'bcrypt';
import { clear, error } from 'node:console';
import jwt from 'jsonwebtoken';
const router = express.Router();

if (!process.env.JWT_SECRET) {
    throw error("Can,t access the env")
}
const JWT_SECRET = process.env.JWT_SECRET;


if (!process.env.BCRYPT_HASH) {
    throw error("Can,t access the env");
}
const BCRYPT_HASH = process.env.BCRYPT_HASH;


router.post("/signup", async (req, res) => {
    const main = signup_val.safeParse(req.body);
    if (!main.success) {
        return res.status(403).json({
            success: false,
            message: "Please check the input"
        })
    }
    const { username, password, email } = main.data;
    try {
        const find_existing = await prisma.user.findUnique({ where: { email:email } });
        if (find_existing) {
            return res.status(402).json({
                success: false,
                message: "User Already Exist | Try with different email"
            })
        }
        const hash = await bcrypt.hash(password, BCRYPT_HASH);
        const new_user = await prisma.user.create({
            data: {
                username: username,
                email: email,
                password: hash
            },
            select: {
                email: true,
                id: true
            }
        })
        const token = jwt.sign({ id: new_user.id, email: new_user.email }, JWT_SECRET);
        return res.status(200).json({
            success: true,
            message: "Signup Done Successfully",
            details: new_user,
            token: token
        })

    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        })
    }
})


router.post("/login", async (req, res) => {
    const main = signin_val.safeParse(req.body);
    if (!main.success) {
        return res.status(403).json({
            success: false,
            message: "Please check the inputs"
        })
    }
    const { id, email, password } = main.data;
    try {
        const find_existing = await prisma.user.findUnique({ where: { email } });
        if (!find_existing) {
            return res.status(404).json({
                success: false,
                message: "User not found!"
            })
        }
        const guard = await bcrypt.compare(password, find_existing.password);
        if (!guard) {
            return res.status(404).json({
                success: false,
                message: "Incorrect password "
            })
        }
        return res.status(200).json({
            success: true,
            message: "Login Successfully Done"
        })

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        })
    }
})






export default router;