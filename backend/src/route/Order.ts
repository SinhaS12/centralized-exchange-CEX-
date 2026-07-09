import express from 'express';
import { order_val } from '../validation/Order_Val';
import { prisma } from '../db/db.ts';
const router=express.Router();



router.post("/order",async(req,res)=>{
    const main=order_val.safeParse(req.body);
    if(!main.success){
        return res.status(403).json({
            success:false,
            message:"Please check the inputs"
        })
    }
    const {stockname,amount,type,category}=main.data;
    try{
        const order_stock=await prisma.order.create({
            data:{
                stockName:stockname
                amount:amount
                type:type,
                category:category
            },
            select:{
                StockId:true
            }
        })
        return res.status(200).json({
            success:false,
            message:"order successfully done"
        })

    }catch(error){
        return res.status(500).json({
            success:false,
            message:"Internal Server Error"
        })
    }
})








export default router;