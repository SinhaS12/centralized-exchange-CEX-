import z from 'zod';


export const signup_val=z.object({
    username:z.string(),
    password:z.string(),
    email:z.string()
})


export const signin_val=z.object({
    id:z.number(),
    email:z.string(),
    password:z.string()
})




export default module;