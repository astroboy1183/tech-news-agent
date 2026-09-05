function f(x){return x<=0.0031308?12.92*x:1.055*Math.pow(x,1/2.4)-0.055}
export function hex(L,C,H){
  const h=H*Math.PI/180,a=C*Math.cos(h),b=C*Math.sin(h);
  const l=(L+0.3963377774*a+0.2158037573*b)**3,m=(L-0.1055613458*a-0.0638541728*b)**3,s=(L-0.0894841775*a-1.2914855480*b)**3;
  const r=4.0767416621*l-3.3077115913*m+0.2309699292*s,g=-1.2684380046*l+2.6097574011*m-0.3413193965*s,bl=-0.0041960863*l-0.7034186147*m+1.7076147010*s;
  const cl=v=>Math.max(0,Math.min(255,Math.round(f(Math.max(0,Math.min(1,v)))*255)));
  return "#"+[cl(r),cl(g),cl(bl)].map(v=>v.toString(16).padStart(2,"0")).join("");
}
