




interface Wallet{
    balance:number,
    locked:number
}


interface StockHolding{
    holdStock:number,
    locked:number
}


interface UserInfo{
    username:string,
    password:string,
    wallet:Wallet,
    stocks:{
        [stockId:number]:StockHolding;
    }
}




interface User{
    [userId:number]:UserInfo;
}

const user:User={};


