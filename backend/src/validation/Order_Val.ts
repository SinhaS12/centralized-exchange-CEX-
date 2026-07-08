import z from 'zod';



export const order_val=z.object({
    stockname:z.string()
})


export default module;