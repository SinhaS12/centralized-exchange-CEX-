/* 
agar koi bid kiya kisi amount pr.
aur  
agar ussi amount pr utna stock hoga tho. 
match kar do .

pre-requist hoga 
1)Check first is the stock listed on the in memory or not 
after all the matching or the decuation after in memory push the actual thing to 
the postgres db 


conditions before matching 
1)Get the last trading match thing for the calculation of the amount for the stock
2)Amount sufficent
3)Lock Amount
4)Transaction thing sab sath mein execute hoga warna kuch nahi hoga
5)Orderbook bids and ask manupulation 

Orderbook manupulation mein aata hai 
1)stock exchange quantity
    1)stock jada hua tho (agar bid hai tho ok hai minus on utna stock )
    2)Agar stock kaam ho asked se tho match the stock fully and rest order book mein sit hoga.
    aur bid phir asked ban jaiyega 
    3)asked yah bid kisi se match nahi kiya tho orderbook mein kahi bath jaiyega 


Needed information mein 
chailiye 
1)Bid ka data 
2)Stock ka data 
3)ask ka data 
4)User balance ka data 



Algorith kya usse karenge 
1)I think Map usse karnege O(1) mein aa jaiyega 
"AXIS":{
    LastTrade:$$$$,
    bids:{{amount:{userId: stock:},{userId:, stock:}},{amount :{userId: stock},{userId: ,stock}}},
    asks:{{amount:{userId: stock:},{userId:, stock:}},{amount :{userId: stock},{userId: ,stock}}}
}
2)Learn the inmemory rollin and rollout thing 
*/


bool locking(int USER){
    //yah balance aur deduction dono hoga 
}


#include <string>
bool solve(int ORDERBOOK,int USER,std::string Type,int amount,int quantity){
    /* 
    First check the User balance have the sufficent amount in the Balance 
    If yes then lock that balance form the balance thing 
    state the trasaction thing rollin rollout for the in memory db 
    After decducation use that check the bid or ask obejct using key if there will be any stock
    then match the 
    two cases   
    First one is 
    (Bid case hai)
    1)If the accurate amount of stock is there then ask and bid both will be out 
    2)If the stock is less in the then the asked then match the amount present in the stock and
    rest seat on the oppisite orderbook
    3)if there is no stock in that amount then the order will simply seat on the orderbook
    (Ask mein )
    1)Agar stock mila tab same bid jaise tho upper wala hee hoga 
    2)warna phir agar same amount exist krta hai tho ussme add ho jaiyge jisse amount of stock 
    register hoga 
    */
}




#include<bits/stdc++.h>
using namespace std;
#define  endl "\n"
signed main(){
    solve(ORDERBOOK,USER,Type,amount quantity);
}