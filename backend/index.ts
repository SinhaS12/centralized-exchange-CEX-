import express from 'express';
import { error } from 'node:console';
const app=express();
if(!process.env.PORT){
    throw error("Can not access the PORT");
}
const PORT=process.env.PORT;
app.use(express.json())





app.listen(PORT,()=>{
    console.log(`PORT is listening on ${PORT}`)
})



