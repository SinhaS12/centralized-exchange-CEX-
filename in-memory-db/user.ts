

interface User{
    [id:number]:{
        username:string,
        password:string
    },
    wallet:{
        balance:number,
        locked:number
    },
    stock:{
        [stockId:number]:{
            holdStock:number,
            locked:number
        }
    }
}
/* User:[{1:{username,password},wallet:{balance,locked},stock:{3:{holdStock,locked}}}] */




const user:User[]=[];


/* 
Why array not object ?
Ans:-Array mein iterate krenge 
Object mein key find and result 
then why Array not object



What is the work of the interface?
Ans:-Its help to define the strucutre rule 
*/