'use strict';
const price=['price-mode','price-value'];
const output=['output','overwrite','unknown-stock'];
const OPTIONS={
  url:{type:'string',multiple:true,description:'淘宝/天猫商品链接；可重复'},
  'links-file':{type:'string',description:'逐行链接文件，- 表示 stdin；与 --url 互斥'},
  'job-id':{type:'string',description:'任务 ID：1–64 位字母、数字、连字符、下划线'},
  'data-dir':{type:'string',description:'任务目录，默认 ~/.stockflow；不与插件面板批次混用'},
  output:{type:'string',description:'CSV 输出路径，相对调用目录；不会上传为公网链接'},
  overwrite:{type:'boolean',description:'允许替换已有输出文件，默认拒绝'},
  'price-mode':{type:'string',enum:['original','fixed','percent'],description:'默认 original；export/resume 省略则沿用任务设置'},
  'price-value':{type:'string',description:'fixed：元，可正负；percent：大于0且不超过1000；最多两位小数'},
  'unknown-stock':{type:'string',enum:['zero','error'],description:'默认 zero：未知库存按0导出并返回警告；error：阻止导出'},
  'dry-run':{type:'boolean',description:'只读取并校验输入和输出路径，不写任务、不打开浏览器'},
  'user-ready':{type:'boolean',description:'用户明确完成登录/验证后才传入，用于恢复交出的浏览器'},
  limit:{type:'string',description:'jobs list 条数，默认20，最大100'},
};
const COMMANDS={
  collect:{options:['url','links-file','job-id',...price,...output,'dry-run'],required:['output'],description:'顺序采集多链接并导出 CSV；重复 job-id 拒绝覆盖，请查询或恢复'},
  'jobs list':{options:['limit'],required:[],description:'列出近期任务，不访问浏览器'},
  'jobs get':{options:['job-id'],required:['job-id'],description:'读取任务与逐项状态；不重复采集'},
  'jobs resume':{options:['job-id','user-ready',...price,...output],required:['job-id'],description:'继续未完成项，保留成功项；沿用原输出路径和规则'},
  'jobs retry':{options:['job-id','user-ready',...price,...output],required:['job-id'],description:'重试失败项并继续待采集项，保留成功项'},
  export:{options:['job-id',...price,...output,'dry-run'],required:['job-id','output'],description:'从已保存的原始采集结果重新调价导出，不访问浏览器'},
  doctor:{options:[],required:[],description:'检查 Node、ego lite 连接；不验证商品登录状态，不创建浏览器窗口'},
};
class CliError extends Error {
  constructor(code,message,exitCode=2,hint){super(message);this.code=code;this.exitCode=exitCode;this.hint=hint;}
}
function parse(argv){
  const args=[...argv];
  if(!args.length||['help','--help','-h'].includes(args[0]))return {command:'help',options:{}};
  if(['version','--version'].includes(args[0])&&args.length===1)return {command:'version',options:{}};
  if(args[0]==='schema'){
    const target=args.slice(1).join(' ');if(target&&!COMMANDS[target])throw new CliError('INVALID_ARGUMENT','未知命令路径');
    return {command:'help',target,options:{}};
  }
  let command=args.shift();if(command==='jobs')command+=' '+args.shift();
  const spec=COMMANDS[command];if(!spec)throw new CliError('INVALID_ARGUMENT','未知命令，请运行 stockflow --help');
  const options={};
  while(args.length){
    const arg=args.shift();if(arg==='--help')return {command:'help',target:command,options:{}};
    const [key,...inline]=arg.replace(/^--/,'').split('=');
    if(!arg.startsWith('--')||(!spec.options.includes(key)&&key!=='data-dir'))throw new CliError('INVALID_ARGUMENT',`不支持参数 ${arg.split('=')[0]}`);
    const def=OPTIONS[key];if(!def.multiple&&key in options)throw new CliError('INVALID_ARGUMENT',`--${key} 不可重复`);
    let value=true;
    if(def.type!=='boolean'){
      value=inline.length?inline.join('='):args.shift();
      if(value===undefined||value.startsWith('--'))throw new CliError('INVALID_ARGUMENT',`--${key} 缺少参数值`);
    }else if(inline.length)throw new CliError('INVALID_ARGUMENT',`--${key} 不接受值`);
    if(def.enum&&!def.enum.includes(value))throw new CliError('INVALID_ARGUMENT',`--${key} 可选：${def.enum.join(', ')}`);
    if(def.multiple)(options[key]??=[]).push(value);else options[key]=value;
  }
  for(const key of spec.required)if(!options[key])throw new CliError('INVALID_ARGUMENT',`需要 --${key}`);
  return {command,options};
}
module.exports={OPTIONS,COMMANDS,CliError,parse};
