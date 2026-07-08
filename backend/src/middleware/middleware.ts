import type {Request,Response, NextFunction } from "express";
import  jwt, { type JwtHeader, type JwtPayload }  from "jsonwebtoken";
import { error } from "node:console";
if (!process.env.JWT_SECRET) {
    throw error("Can,t access the env")
}
const JWT_SECRET = process.env.JWT_SECRET;


export function middleware(req:Request,res:Response,next:NextFunction){
    const token=req.headers.authorization;
    if(!token){
        return res.status(403).json({
            success:false,
            message:"Please enter the token"
        })
    }
    const bearer=token.split("")[0] as string;
    try{
        const decode=jwt.verify(bearer,JWT_SECRET) as JwtPayload;
        if(!decode){
            return res.status(402).json({
                success:false,
                message:"Invalid Token"
            })
        }
        decode.userId=decode.id;
        next();
    }catch(error){
        console.log(error);
        return res.status(500).json({
            success:false,
            message:"Internal Server Error"
        })
    }
}