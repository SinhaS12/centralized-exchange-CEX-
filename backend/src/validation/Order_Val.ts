import z from 'zod';



export const order_val=z.object({
    stockname:z.string(),
    amount:z.number().optional(),
    type:z.enum(["bid","ask"]),
    category:z.enum(["LIMIT","MARKET"]),
})


export default module;