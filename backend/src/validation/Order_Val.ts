import z from 'zod';



export const order_val=z.object({
    stockname:z.string(),
    category:z.enum(["LIMIT","MARKET"]),
    type:z.enum(["bid","ask"]),
    status:z.enum(["OPEN","FILLED","CANCELLED"]),
    volume:z.number()
})


export default module;