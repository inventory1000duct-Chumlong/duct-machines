
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";

const VERSION="9.1.0-enterprise-stable";
const PORT=process.env.PORT||3000;
const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const app=express();
app.use(cors());
app.use(helmet({contentSecurityPolicy:false}));
app.use(compression());
app.use(express.static(path.join(__dirname,"public")));
const cache=new Map(), lastGood=new Map();
const API={cg:"https://api.coingecko.com/api/v3",cc:"https://api.coincap.io/v2",fng:"https://api.alternative.me/fng/?limit=1"};

const now=()=>new Date().toISOString();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const avg=a=>{a=a.filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:0};
const median=a=>{a=a.filter(Number.isFinite).sort((x,y)=>x-y);return a.length?a[Math.floor(a.length/2)]:0};
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const round=(n,d=2)=>{const p=10**d;return Math.round(n*p)/p};
const rank=g=>({"A+":5,A:4,B:3,C:2,D:1}[g]||0);

async function fetchText(url,timeout=10000){
  const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),timeout);
  try{
    const res=await fetch(url,{signal:ctrl.signal,headers:{"accept":"application/json,text/plain,*/*","user-agent":"Mozilla/5.0 crypto-scanner-v9.1"}});
    const text=await res.text();
    return {ok:res.ok,status:res.status,text};
  } finally {clearTimeout(timer);}
}

async function resilientJSON(key,url,opt={}){
  const ttl=opt.ttl??30000, stale=opt.stale??1800000, retries=opt.retries??2, timeout=opt.timeout??10000;
  const hit=cache.get(key);
  if(hit && Date.now()-hit.t<ttl) return {data:hit.v,source:"fresh-cache",error:null};
  let err=null;
  for(let i=0;i<=retries;i++){
    try{
      const r=await fetchText(url,timeout);
      if(!r.ok) throw new Error(`HTTP ${r.status}: ${r.text.slice(0,100)}`);
      const data=JSON.parse(r.text);
      cache.set(key,{t:Date.now(),v:data}); lastGood.set(key,{t:Date.now(),v:data});
      return {data,source:i?`live-retry-${i}`:"live",error:null};
    }catch(e){err=e; await sleep(350*(i+1));}
  }
  const old=lastGood.get(key)||cache.get(key);
  if(old && Date.now()-old.t<stale) return {data:old.v,source:"stale-cache",error:err?.message||"fetch failed"};
  throw new Error(`${key} failed: ${err?.message||"unknown"}`);
}

function normCG(d){
  if(!Array.isArray(d)) return [];
  return d.map(x=>({id:x.id,symbol:String(x.symbol||"").toUpperCase(),name:x.name||x.id,price:+x.current_price,change24h:+(x.price_change_percentage_24h||0),change7d:+(x.price_change_percentage_7d_in_currency||0),volume:+(x.total_volume||0),marketCap:+(x.market_cap||0),high24h:+(x.high_24h||0),low24h:+(x.low_24h||0)})).filter(x=>x.symbol&&Number.isFinite(x.price)&&x.price>0);
}
function normCC(d){
  if(!d?.data||!Array.isArray(d.data)) return [];
  return d.data.map(x=>({id:x.id,symbol:String(x.symbol||"").toUpperCase(),name:x.name||x.id,price:+x.priceUsd,change24h:+(x.changePercent24Hr||0),change7d:0,volume:+(x.volumeUsd24Hr||0),marketCap:+(x.marketCapUsd||0),high24h:+x.priceUsd*1.03,low24h:+x.priceUsd*0.97})).filter(x=>x.symbol&&Number.isFinite(x.price)&&x.price>0);
}
function demoCoins(){
  return [["BTC","Bitcoin",65000,1.8,5.2,25000000000,1.02,0.98],["ETH","Ethereum",3400,2.4,7.5,12000000000,1.03,.985],["SOL","Solana",150,4.1,12,4200000000,1.06,.975],["BNB","BNB",580,1.2,3.4,1600000000,1.025,.985],["XRP","XRP",.52,.8,2.2,1300000000,1.03,.98],["DOGE","Dogecoin",.13,5.5,9.1,1800000000,1.08,.96],["ADA","Cardano",.42,2.1,4.5,800000000,1.04,.975],["AVAX","Avalanche",28,3.2,8.4,700000000,1.06,.965],["LINK","Chainlink",14.5,2.8,6.3,600000000,1.05,.97],["WLD","Worldcoin",2.1,1.5,4.2,520000000,1.04,.98]].map(([symbol,name,price,change24h,change7d,volume,hi,lo])=>({id:symbol.toLowerCase(),symbol,name,price,change24h,change7d,volume,marketCap:volume*20,high24h:price*hi,low24h:price*lo}));
}
async function getCoins(limit){
  const diagnostics=[];
  try{
    const url=`${API.cg}/coins/markets?vs_currency=usd&order=volume_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=7d`;
    const r=await resilientJSON(`cg_${limit}`,url,{ttl:30000,stale:1800000,retries:2,timeout:12000});
    const coins=normCG(r.data); diagnostics.push({provider:"CoinGecko",ok:coins.length>0,source:r.source,error:r.error});
    if(coins.length) return {source:`CoinGecko (${r.source})`,coins,diagnostics};
  }catch(e){diagnostics.push({provider:"CoinGecko",ok:false,error:e.message});}
  try{
    const r=await resilientJSON(`cc_${limit}`,`${API.cc}/assets?limit=${limit}`,{ttl:30000,stale:1800000,retries:2,timeout:12000});
    const coins=normCC(r.data); diagnostics.push({provider:"CoinCap",ok:coins.length>0,source:r.source,error:r.error});
    if(coins.length) return {source:`CoinCap (${r.source})`,coins,diagnostics};
  }catch(e){diagnostics.push({provider:"CoinCap",ok:false,error:e.message});}
  diagnostics.push({provider:"DemoFallback",ok:true,source:"local-safe-data",error:"external providers unavailable"});
  return {source:"DemoFallback (external APIs unavailable)",coins:demoCoins().slice(0,limit),diagnostics};
}
async function getFng(){
  try{const r=await resilientJSON("fng",API.fng,{ttl:1800000,stale:21600000,retries:1,timeout:8000}); return {value:+(r.data?.data?.[0]?.value||0)||null,source:r.source,error:r.error};}
  catch(e){return {value:null,source:"unavailable",error:e.message};}
}
function regime(avg24,medAbs){if(avg24<-4)return"CRASH_RISK";if(medAbs>10)return"HIGH_VOL";if(avg24>1)return"TREND_UP";if(avg24<-1)return"TREND_DOWN";return"SIDEWAY"}
function estRR(c,v){let b=c.change24h>0&&c.change24h<8?2:c.change24h>=8?1.45:c.change24h<0?1.55:1.75;if(c.change7d>0)b+=.12;if(v>=2&&v<=10)b+=.15;if(v>16)b-=.25;return clamp(b,1.1,2.5)}
function scoreCoin({coin,volRatio,rr,trend,regime,fear}){let score=0,reasons=[],penalties=[];if(trend==="BULLISH"){score+=18;reasons.push("Market Bull")}else if(trend==="NEUTRAL"){score+=8;reasons.push("Market Neutral")}else{score-=15;penalties.push("Market Bear")}if(regime==="TREND_UP"){score+=12;reasons.push("Regime Trend Up")}else if(regime==="HIGH_VOL"){score-=12;penalties.push("High Volatility")}else if(regime==="CRASH_RISK"){score-=25;penalties.push("Crash Risk")}if(fear!==null){if(fear>=25&&fear<=75){score+=6;reasons.push("F&G Normal")}else if(fear>82){score-=8;penalties.push("Extreme Greed")}else if(fear<18){score-=6;penalties.push("Extreme Fear")}}if(coin.change24h>0&&coin.change24h<8){score+=18;reasons.push("24h Healthy")}else if(coin.change24h>=8){score-=10;penalties.push("ระวังไล่ราคา")}else if(coin.change24h<-5){score-=10;penalties.push("24h Weak")}if(coin.change7d>0&&coin.change7d<25){score+=10;reasons.push("7d Trend ดี")}else if(coin.change7d<-12){score-=8;penalties.push("7d Weak")}if(volRatio>=2){score+=22;reasons.push("Volume สูง")}else if(volRatio>=1.4){score+=14;reasons.push("Volume ดี")}else{score+=4;reasons.push("Volume ปานกลาง")}if(rr>=2){score+=18;reasons.push("R:R ≥ 1:2")}else if(rr>=1.8){score+=12;reasons.push("R:R พอใช้")}else{score-=6;penalties.push("R:R ต่ำ")}return{score:clamp(Math.round(score),0,100),reasons,penalties}}
function grade(score,rr,vr,reg){if(reg==="CRASH_RISK")return"D";if(score>=85&&rr>=2&&vr>=2)return"A+";if(score>=75&&rr>=1.8&&vr>=1.8)return"A";if(score>=60)return"B";if(score>=50)return"C";return"D"}
function plan(c){const range=c.price?Math.abs((c.high24h-c.low24h)/c.price)*100:4,vol=Math.max(Math.abs(c.change24h||0),range,2),rr=estRR(c,vol),atr=c.price*Math.max(vol/100,.018),entryHigh=c.price,entryLow=Math.max(c.price-atr*.35,c.price*.985),sl=Math.max(c.price-atr*.75,c.price*.97);return{volatility:vol,rr,entryLow,entryHigh,sl,tp1:c.price+(c.price-sl)*1.2,tp2:c.price+(c.price-sl)*2,tp3:c.price+(c.price-sl)*3}}
async function healthOne(name,url){const start=Date.now();try{const r=await fetchText(url,8000);return{name,ok:r.ok,status:String(r.status),latencyMs:Date.now()-start,detail:r.ok?"ok":r.text.slice(0,80)}}catch(e){return{name,ok:false,status:e.message,latencyMs:Date.now()-start,detail:"fetch failed"}}}

app.get("/api/health",async(req,res)=>{const services=await Promise.all([healthOne("CoinGecko",`${API.cg}/ping`),healthOne("CoinCap",`${API.cc}/assets?limit=1`),healthOne("Fear & Greed",API.fng)]);res.json({ok:services.some(s=>s.ok),version:VERSION,time:now(),cacheKeys:[...cache.keys()],services})});
app.get("/api/scan",async(req,res,next)=>{try{const limit=clamp(parseInt(req.query.limit||"50",10)||50,10,100),pack=await getCoins(limit),fearObj=await getFng(),fear=fearObj.value,avg24=avg(pack.coins.map(x=>x.change24h)),medAbs=median(pack.coins.map(x=>Math.abs(x.change24h))),trend=avg24>1.2?"BULLISH":avg24<-1.2?"BEARISH":"NEUTRAL",reg=regime(avg24,medAbs),medVol=median(pack.coins.map(x=>x.volume));const rows=pack.coins.map(c=>{const p=plan(c),vr=medVol?Math.max(.1,c.volume/medVol):1,sc=scoreCoin({coin:c,volRatio:vr,rr:p.rr,trend,regime:reg,fear}),g=grade(sc.score,p.rr,vr,reg);return{symbol:c.symbol,name:c.name,price:c.price,change24h:round(c.change24h,2),change7d:round(c.change7d,2),marketCap:c.marketCap,volume:c.volume,volumeRatio:round(vr,2),rr:round(p.rr,2),score:sc.score,grade:g,reasons:sc.reasons,penalties:sc.penalties,volatility:round(p.volatility,2),entryLow:round(p.entryLow,8),entryHigh:round(p.entryHigh,8),sl:round(p.sl,8),tp1:round(p.tp1,8),tp2:round(p.tp2,8),tp3:round(p.tp3,8)}}).sort((a,b)=>rank(b.grade)-rank(a.grade)||b.score-a.score);res.json({ok:true,version:VERSION,source:pack.source,time:now(),diagnostics:pack.diagnostics,market:{trend,regime:reg,fng:fear,avg24:round(avg24,2),medAbs:round(medAbs,2),fearSource:fearObj.source,fearError:fearObj.error},rows})}catch(e){next(e)}});
app.get("/api/debug",(req,res)=>res.json({ok:true,version:VERSION,cacheKeys:[...cache.keys()],lastGoodKeys:[...lastGood.keys()],time:now()}));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({ok:false,error:err.message||String(err),version:VERSION,time:now()})});
app.listen(PORT,()=>console.log(`Crypto Scanner V9.1 running on port ${PORT}`));
