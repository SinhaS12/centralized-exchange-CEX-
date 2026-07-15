



interface Order {
    [stockName: string]: {
        bids: [
            { userId: number, volume: number, amount: number }
        ],
        asks: [
            { userId: number, volume: number, amount: number }
        ],
        latestTrade: number
    }
}




const order: Order[] = [];


/* 
Again wahi question why array and not object 
as array need iteration and object does not need that it need keys;


why bids and asks in object or array explain 
*/