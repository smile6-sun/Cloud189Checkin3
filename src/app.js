require("dotenv").config();
const fs = require("fs");
const { CloudClient, FileTokenStore } = require("cloud189-sdk");
const recording = require("log4js/lib/appenders/recording");
const accounts = require("../accounts");
const families = require("../families");
const { mask, delay } = require("./utils");
const push = require("./push");
const { log4js, cleanLogs, catLogs } = require("./logger");
 const logger = log4js.getLogger();
    logger.addContext("user", "" );
const execThreshold = process.env.EXEC_THRESHOLD || 1;
const tokenDir = ".token";
let firstUserName;  //主账号
const isMainAccount = true;
const originalLog = (message) => {
    console.log('');
    logger.log(message);
  };
  let accountIndex = 1;  //家庭序号



// 个人任务签到
const doUserTask = async (cloudClient) => {
	if (!isMainAccount || accountIndex > 1)  return;

  const tasks = Array.from({ length: 1 }, () =>
    cloudClient.userSign()
  );
  const result = (await Promise.allSettled(tasks)).filter(
    ({ status, value }) => status === "fulfilled" && !value.isSign
  );
   console.log(
    `${result.length}/${tasks.length} 个人获得(M): ${
      result.map(({ value }) => value.netdiskBonus)?.join(" ") || "0"
    }`
  );
  await delay(2000); // 延迟2秒
};

// 家庭任务签到
const doFamilyTask = async (cloudClient, acquireFamilyTotalSize,errorMessages,userNameInfo) => {
  const { familyInfoResp } = await cloudClient.getFamilyList();
  if (!familyInfoResp) {
	  console.log(`未能获取家庭信息`);
      return errorMessages.push(`${accountIndex}. 账号 ${userNameInfo} 错误: 未能获取家庭信息`);
    }
  
    let familyId = null;
    //指定家庭签到
    if (families.length > 0) {
      const targetFamily = familyInfoResp.find((familyInfo) =>
        families.includes(familyInfo.familyId)
      );
      if (targetFamily) {
        familyId = targetFamily.familyId;
      } else {
		  console.log(`没有加入到指定家庭分组`);
        return errorMessages.push(`${accountIndex}. 账号 ${userNameInfo} 错误: 没有加入指定家庭组`);
      }
    } else {
      familyId = familyInfoResp[0].familyId;
    }
	
   
    const tasks = Array.from({ length: accountIndex == 1? 1: execThreshold }, () =>
      cloudClient.familyUserSign(familyId)
    );
    const result = (await Promise.allSettled(tasks)).filter(
      ({ status, value }) => status === "fulfilled" && !value.signStatus
    );
	result.forEach(({ value }) => {
		if (value.bonusSpace !== undefined && value.bonusSpace !== null) {
			acquireFamilyTotalSize.push(value.bonusSpace);
		}
	});
	return console.log(
      `${result.length}/${tasks.length} 家庭获得(M): ${
       result.map(({ value }) => value.bonusSpace)?.join(",") || "0"
      }`
    );
	
};

const run = async (userName, password, userSizeInfoMap, acquireFamilyTotalSize,errorMessages) => {
  if (userName && password) {
    const before = Date.now();
	const userNameInfo = mask(userName, 3, 7);
	 if(isMainAccount && accountIndex == 1){
			firstUserName = userNameInfo;
		}
    try {
       logger.log(`${accountIndex}. 账号 ${userNameInfo}`);
      const cloudClient =  new CloudClient({
        username: userName,
        password,
        token: new FileTokenStore(`${tokenDir}/${userName}.json`),
      });
    // const beforeUserSizeInfo = await cloudClient.getUserSizeInfo();
    //  userSizeInfoMap.set(userName, {
    //    cloudClient,
    //    userSizeInfo: beforeUserSizeInfo
    //  });
      
       //await doUserTask(cloudClient);
       //await doFamilyTask(cloudClient,acquireFamilyTotalSize,errorMessages,userNameInfo);
	   const { familyInfoResp } = await cloudClient.getFamilyList();
		logger.log(`有${familyInfoResp.length}个家庭：`);
	   if (familyInfoResp){
	    for(let i = 0; i < familyInfoResp.length ; i++ ){
			logger.log(`familyId: ${familyInfoResp[i].familyId}`);			
		}
	   }
	   
		const userSizeInfo = await cloudClient.getUserSizeInfo();
		logger.log(
      `个人容量：⬆️  ${(
        (userSizeInfo.cloudCapacityInfo.totalSize) /
        1024 /
        1024 /
		1024
      ).toFixed(2)}G`,
      `家庭容量：⬆️  ${(
        ( userSizeInfo.familyCapacityInfo.totalSize) /
        1024 /
        1024 /
		1024
      ).toFixed(2)}G`
    );
		
      
    } catch (e) {
      logger.log(e);
      if (e.code === "ECONNRESET" || e.code === "ETIMEDOUT") {
        console.log(`${accountIndex}. 账号 ${userNameInfo}请求超时`);
        throw e;
      }else{
		
		errorMessages.push( `${accountIndex}. 账号 ${userNameInfo} 错误: ${
    typeof e === "string" ? e : e.message || "未知错误"
  }`);
      
	  }
	  
    } finally {
     logger.log(
        `耗时 ${((Date.now() - before) / 1000).toFixed(2)} 秒`
      );
	  logger.log(' ');
	 await delay((Math.random() * 3000) + 1000); // 随机等待1到3秒
    }
  }
};

// 开始执行程序
async function main() {
	const acquireFamilyTotalSize = [];  //获得家庭总量 
	const errorMessages = [];
	
	
  if (!fs.existsSync(tokenDir)) {
    fs.mkdirSync(tokenDir);
  }
  //  用于统计实际容量变化
  const userSizeInfoMap = new Map();
  
	const accountsdel = accounts.flatMap(line => {
		return line
			.split(/\s+/) // 按任意空白符分割
			.filter(item => item.length > 0) // 防止空字符串
});
  for (let index = 0; index < accountsdel.length; index += 2) {
    const [ userName, password ] = accountsdel.slice(index, index + 2);
    await run(userName, password, userSizeInfoMap, acquireFamilyTotalSize,errorMessages);
	accountIndex++;
  }
  accountIndex--;
 
 
  // 错误信息输出
  if (errorMessages.length > 0) {
    originalLog(' ');
    originalLog('错误信息'+errorMessages.length+'个: ');
    errorMessages.forEach(msg => originalLog(msg));
  }
  
}

(async () => {
  try {
    await main();
    //等待日志文件写入
    await delay(1000);
  } finally {
    const logs = catLogs();
    const events = recording.replay();
    const content = events.map((e) => `${e.data.join("")}`).join("  \n");
    push("天翼云盘账号查询结果", logs + content);
    recording.erase();
    cleanLogs();
  }
})();
