import express from 'express';
const router=express.Router();



router.post("/order",async(req,res)=>{
    try{

    }catch(error){
        return res.status(500).json({
            success:false,
            message:"Internal Server Error"
        })
    }
})








export default router;