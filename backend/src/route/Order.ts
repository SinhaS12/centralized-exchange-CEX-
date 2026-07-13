import express from 'express';
import { order_val } from '../validation/Order_Val';
import { prisma } from '../db/db.ts';
const router = express.Router();

const ORDER = [];

router.post("/order", async (req, res) => {
    const main = order_val.safeParse(req.body);
    if (!main.success) {
        return res.status(404).json({
            success: false,
            message: "Please check you correct value "
        })
    }
    const { stockname, category, type, status, volume } = main.data;
    try {
        const order_now = await prisma.order.create({
            data: {
                stockname,
                category,
                type,
                status,
                volume
            },
            select: {
                stockname: true
            }
        })
        return res.status(200).json({
            success: true,
            message: "Order done successfully",
            details: order_now
        })

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        })
    }
})


router.get("/order/:orderid", async (req, res) => {
    const orderid = req.params.orderid;
    const conversion = parseInt(orderid);
    if (!orderid || conversion) {
        return res.status(402).json({
            success: false,
            message: "Please enter the orderId"
        })
    }
    try {
        const find_order_details = await prisma.order.findUnique({
            where: { id: conversion }, select: {
                volume: true,
                amount: true
            }
        });
        if (!find_order_details) {
            return res.status(403).json({
                success: false,
                message: "No order found "
            })
        }
        return res.status(200).json({
            success:true,
            message:"Order got successfully",
            details:find_order_details
        })
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        })
    }
})


router.get("/depth/:stocksymbol", async (req, res) => {
    const stocksymbol=req.params.stocksymbol;
    if(!stocksymbol){
        return res.status(403).json({
            success:false,
            message:"Please enter the stockName "
        })
    }
    try {
        //inmemory thing 
        

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        })
    }
})


router.delete("/order/:orderid", async (req, res) => {
    const orderid=parseInt(req.params.orderid);
    if(!orderid){
        return res.status(403).json({
            success:false,
            message:"Please enter  orderId"
        })
    }
    try {
        //wasise tho yah bhi im mrmoey hai but 
        const findid=await prisma.order.delete({where:{id:orderid}});
        if(!findid){
            return res.status(403).json({
                success:false,
                message:"id does not exist"
            })
        }
        return res.status(403).json({
            success:false,
            message:"Order deleted Successfully"
        })
        

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        })
    }
})








export default router;