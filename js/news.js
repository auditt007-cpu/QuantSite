(function (root) {
  const POLL_MS = 60000;
  const CC = "https://min-api.cryptocompare.com/data/v2/news/?extraParams=quantalpha&lang=";
  const RSS =
    "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent("https://cointelegraph.com/rss");

  const S =
    "国对发会时这来对过经现为学体产内说们用电同长机实战进与从开关问题点动头面条只无条系气声车门马风云龙万与丑专业丛东丝两严丧个丰临为丽举么义乌乐乔习乡书买乱争于亏云亚产亩亲亵亿仅从仑仓仪们价众优会伛伞伟传伤伥伦伧伪伫体余佣佥侠侣侥侦侧侨侩侪侬俣俦俨俩俪俭债倾偻偿傥傧储傩儿兑兖兰关兴养兽冈册军农冯冻净凄凉凌减凑凛几凤凫凭凯击凿刍划刘则刚创删别刭刹刽刿剀剂剐剑剖剥剧劝办务劢动劲劳势勋勐励勋劝匀匦匮区医华协单卖卢卤卧卫却卷厂厅历厉压厌厍厕厢厫厦厨厮县叁参双发变叙叠叶号叹叽吁后吓吕吗吣吨听启吴呒呓呕呖呗员呙呛呜咏咙咛咝咤响哑哒哓哔哕哗哙哜哝哟唛唝唠唡唢唤啧啬啭啮啰啴啸喷喽喾嗫嗳嘘嘤嘱噜噼嚣团园围囵国图圆圣场坏块坚坛坜坝坞坟坠垄垅垆垒垦垩垫垭垯垱垲埘埙埚埝埯堑堕墙墒增墟墚垦壁壕壤壮声壳壶处备复够头夸夹夺奁奂奋奖妆妪妩娅娆娇娈娘娱娲娴婳婴婵婶媪嫒嫔嫱嬷孙学孪宁宝实宠审宪宫宽宾对寻导寿将尔尘尝尧尴尸尽层屃屉届属屡屦屿岁岂岖岗岘岚岛岗岭崃崄崭嵘嵚嵝巅巩币帅师帐帜带帧帮帱帻帼幂干并广庄庆庐庑库应庙庞废庼廪开异弃张弥弯弹强归当录彟彦彻征径徕御忆忏忧忾怀态怂怃怄怅怆总怼怿恋恳恶恸恹恺恻恼恽悦悫悬悭悯惊惧惨惩惫惬惭惮惯愠愤愦愿慑憷懑懒懔戆戋戏戗战戬户扎扑扒打扔扩扪扫扬扰抚抛抟抠抡抢护报担拟拢拣拥拦拧拨择挂挚挛挜挝挞挟挠挡挢挣挤挥挦捞损捡换捣据捻掳掴掷掸掺掼揽揿搀搁搂搅携摄摅摆摇摈摊撄撑撵撷撸撺擞攒敌敁数斋斓斩断旋无时旷旸昙昼昽显晋晒晓晔晕晖暂暧术机杀杂权条来杨杩杰松板极构枞枢枣枥枧枨枪枫枭柜柠柽栀栅标栈栉栊栋栌栎栏树栖样栾桊桠桡桢档桤桥桦桧桨桩梦梼梾检棂椁椟椠椭楼榄榅榆榇榈榉槚槛槟槠横樯樱橥橱橹橼檐檩欢欤欧歼殇残殒殓殚殡殴毂毕毙毡毵氇气氢氩氲氽汇汉污汤汹沈沟没沣沤沥沦沧沨沩沪沵泞注泪泶泷泸泺泻泼泽泾洁洒洼浃浅浆浇浊测浍济浏浑浒浓浔涛涝涞涟涠涡涣涤润涧涨涩淀渊渌渍渎渐渑渔渖渗温湾湿溃溅溆滗滚滞滟滠满滢滤滥滦滨滩滪漤潆潇潋潍潜潴澜濑濒灏灭灯灵灾灿炀炉炖炜炝点炼炽烁烂烃烛烟烦烧烨烩烫烬热焕焖焘煅煳熘爱爷牍牦牵牺犊犋犭状犷犸犹狈狍狝狞独狭狮狯狰狱狲猃猎猕猡猪猫猬献獭玑玙玚玛玮环现玱玺珐珑珰珲琎琏琐琼瑶瑷璇璎瓒瓮瓯电画畅畴疖疗疟疠疡疬疮疯疱疴痈痉痒痖痨痫痰痴瘅瘆瘗瘘瘪瘫瘾瘿癞癣癫皑皱皲盏盐监盖盗盘眍眦睑睁睐睑瞒瞩矫矶矾矿砀码砖砗砚砜砺砻砾础硕硖硗硙硚确硷碍碛碜碱碹磙磁磅礴礼祎祯祷祸禀禄禅离秃秆种积称秽秾稆税稣稳穑穷窃窍窑窜窝窥窦窭竖竞笃笋笔笕笺笼笾筑筚筛筜筝筹筼签简箓箦箧箨箩箪箫篑篓篮篱簖籁籴类籼粜粝粤粪粮糁糇紧絷纟纠纡红纣纤纥约级纨纩纪纫纬纭纮纯纰纱纲纳纴纵纶纷纸纹纺纻纼纽纾线绀绁绂练组绅细织终绉绊绋绌绍绎经绐绑绒结绔绕绖绗绘给绚绛络绝绞统绠绡绢绣绤绥绦继绨绩绪绫续绮绯绰绱绲绳维绵绶绷绸绹绺绻综绽绾绿缀缁缂缃缄缅缆缇缈缉缊缋缌缎缏缐缑缒缓缔缕编缗缘缙缚缛缜缝缟缠缡缢缣缤缥缦缧缨缩缪缫缬缭缮缯缰缱缲缳缴缵罂网罗罚罢罴羁羟翘耢耧耸聂聋职聍联聩聪肃肠肤肷肾肿胀胁胆背胧胨胪胫胶脉脍脏脐脑脓脔脚脱脶脸脾腊腋腌腐腑腘腭腻腼腽腾膑腭膪臌臜临台与兴举旧时会机权亲观见观规觅视觇览觉觊觋觌觎觏觐觑觞触觯讠计订讣认讥讦讧讨让讪讫训议讯记讲讳讴讵讶讷许讹论讼讽设访诀证诂诃评诅识诈诉诊诋诌词诎诏译诒诓诔试诖诗诘诙诚诛诜话诞诟诠诡询诣诤该详诧诨诩诫诬语诮误诰诱诲诳说诵请诸诹诺读诼诽课诿谀谁谂调谄谅谆谇谈谊谋谌谍谎谏谐谑谒谓谔谕谖谗谘谙谚谛谜谝谟谠谡谢谣谤谥谦谧谨谩谪谫谬谭谮谯谰谱谲谳谴谵谶谷豉豚贝贞负贡财责贤败账货质贩贪贫贬购贮贯贰贱贲贳贴贵贶贷贸费贺贻贼贽贾贿赀赁赂赃资赅赆赇赈赉赊赋赌赍赎赏赐赑赒赓赔赕赖赗赘赙赚赛赜赝赞赠赡赢赣赵赶起趋趱趸跃跄跖跞跻踊踌踪踬踯蹑蹒蹰蹿躏轧轨轩轪轫转轭轮软轰轱轲轳轴轵轶轷轸轹轺轻轼载轾轿辀辁辂较辄辅辆辇辈辉辊辋辌辍辎辏辐辑辒输辔辕辖辗辘辙辚辞辟辩辫边辽达迁过迈运还这进远违连迟迩迳迹选逊递逦逻遗遥邓邝邬邮邹邺邻郁郏郑郓郦郧郸酝酦酱酽酾酿释鉴銮錾针钉钊钋钌钍钎钏钐钒钓钔钕钶钗钙钚钛钝钞钟钠钡钢钣钤钥钦钧钨钩钪钫钬钭钮钯钰钱钲钳钴钵钷钹钺钻钼钽钾钿铀铁铂铃铄铅铆铈铉铊铋铌铍铎铏铐铑铒铕铗铘铙铚铛铜铝铞铟铠铡铢铣铤铥铦铧铨铩铪铫铬铭铮铯铰铱铲铳铴铵银铷铸铹铺铻铼铽链铿销锁锂锃锄锅锆锇锈锉锊锋锌锎锏锐锑锒锓锔锕锖锗错锚锛锜锝锞锟锡锢锣锤锥锦锨锩锪锫锬锭键锯锰锱锲锳锴锵锶锷锸锹锺锻锼锽锾锿镀镁镂镃镄镅镆镇镈镉镊镋镌镍镎镏镐镑镒镓镔镕镖镗镘镚镛镜镝镞镟镠镡镢镣镤镥镦镧镨镩镪镫镬镭镯镰镱镲镳镶长门闩闪闫闬闭问闯闰闱闲闳间闵闶闷闸闹闺闻闼闽闾闿阀阁阂阃阄阅阆阇阈阉阊阋阌阍阎阏阐阑阒阓阔阕阖阗阘阙阚阛队阳阴阵阶际陆陇陈陉陕陧陨险随隐隶隽难雏雠雳雾霁霉霭靓静面靥鞑鞒鞯韦韧韩韪韫韬韵页顶顷顸项顺须顼顽顾顿颀颁颂颃预颅领颇颈颉颊颋颌颍颎颏颐频颓颔颖颗题颙颚颛颜额颞颟颠颡颢颥颤颒风飏飐飑飒飓飔飕飖飗飘飙飚飞飨餍饣饤饥饦饧饨饩饪饫饬饭饮饯饰饱饲饳饴饵饶饷饸饹饺饻饼饽饾饿馀馁馂馃馄馅馆馇馈馉馊馋馌馍馎馏馐馑馒馓馔馕马驭驮驯驰驱驲驳驴驵驶驷驸驹驺驻驼驽驾驿骀骁骂骃骄骅骆骇骈骉骊骋验骍骎骏骐骑骒骓骔骕骖骗骘骙骚骛骜骝骞骟骠骡骢骣骤骥骧骨髅髋髌鬓鬶鱼鱽鱾鱿鲀鲁鲂鲃鲅鲆鲇鲈鲉鲊鲋鲌鲍鲎鲏鲐鲑鲒鲔鲕鲖鲗鲘鲙鲚鲛鲜鲝鲟鲠鲡鲢鲣鲤鲥鲦鲧鲨鲩鲪鲫鲬鲭鲮鲯鲰鲱鲲鲳鲴鲵鲷鲸鲹鲺鲻鲼鲽鲾鲿鳀鳁鳂鳃鳄鳅鳆鳇鳈鳉鳊鳋鳌鳍鳎鳏鳐鳑鳒鳓鳔鳕鳖鳗鳘鳙鳛鳜鳝鳞鳟鳠鳡鳢鳣鸟鸠鸡鸢鸣鸤鸥鸦鸧鸨鸩鸪鸫鸬鸭鸮鸯鸰鸱鸲鸳鸴鸵鸶鸷鸸鸹鸺鸻鸼鸽鸾鸿鹀鹁鹂鹃鹄鹅鹆鹇鹈鹉鹊鹋鹌鹍鹎鹏鹑鹒鹓鹔鹕鹖鹗鹘鹙鹚鹛鹜鹝鹞鹟鹠鹡鹢鹣鹤鹥鹦鹧鹨鹩鹪鹫鹬鹭鹮鹯鹰鹱鹲鹳鹴卤鹾麦麸黄黉黡黩黪黾齐齑齿龀龁龂龃龄龅龆龇龈龉龊龋龌龙龚龛龟";
  const T =
    "國對發會時這來對過經現為學體產內說們用電同長機實戰進與從開關問題點動頭麵條隻無條繫氣聲車門馬風雲龍萬與醜專業叢東絲兩嚴喪個豐臨為麗舉麼義烏樂喬習鄉書買亂爭於虧雲亞產畝親褻億僅從侖倉儀們價眾優會傴傘偉傳傷倀倫傖偽佇體餘傭僉俠侶僥偵側僑儈儕儂俁儔儼倆儷儉債傾僂償儻儐儲儺兒兌兗蘭關興養獸岡冊軍農馮凍淨淒涼淩減湊凜幾鳳鳧憑凱擊鑿芻劃劉則剛創刪別剄剎劊劌剴劑剮劍剖剝劇勸辦務勱動勁勞勢勛勐勵勳勸勻匭匱區醫華協單賣盧鹵臥衛卻捲廠廳曆厲壓厭厙廁廂厫廈廚廝縣叄參雙發變敘疊葉號歎嘰籲後嚇呂嗎唚噸聽啟吳嘸囈嘔嚦唄員咼嗆嗚詠嚨嚀噝吒響啞噠嘵嗶噦嘩噲嚌噥喲嘜嗊嘮啢嗩喚嘖嗇囀齧囉嘽嘯噴嘍嚳囁噯噓嚶囑嚕劈囂團園圍圇國圖圓聖場壞塊堅壇壢壩塢墳墜壟壠壚壘墾堊墊埡墶壋塏塒塤堝墊垵塹墮牆墑增墟墚墾壁壕壤壯聲殼壺處備複夠頭誇夾奪奩奐奮獎妝嫗嫵婭嬈嬌孌孃娛媧嫻嫿嬰嬋嬸媼嬡嬪嬙嬤孫學孿寧寶實寵審憲宮寬賓對尋導壽將爾塵嘗堯尷屍盡層屭屜屆屬屢屨嶼歲豈嶇崗峴嵐島崗嶺崍嶮嶄嶸嶔嶁巔鞏幣帥師帳幟帶幀幫幬幘幗冪幹並廣莊慶廬廡庫應廟龐廢廎廩開異棄張彌彎彈強歸當錄彟彥徹征徑徠禦憶懺憂愾懷態慫憮慪悵愴總懟懌戀懇惡慟懨愷惻惱惲悅愨懸慳憫驚懼慘懲憊愜慚憚慣慍憤憒願懾怵懣懶懍戇戔戲戧戰戩戶紮撲扒打扔擴捫掃揚擾撫拋摶摳掄搶護報擔擬攏揀擁攔擰撥擇掛摯攣掗撾撻挾撓擋撟掙擠揮撏撈損撿換搗據撚擄摑擲撣摻摜攬撳攙擱摟攪攜攝攄擺搖擯攤攖撐攆擷擼攛擻攢敵敁數齋斕斬斷旋無時曠暘曇晝曨顯晉曬曉曄暈暉暫曖術機殺雜權條來楊榪傑鬆板極構樅樞棗櫪梘棖槍楓梟櫃檸檉梔柵標棧櫛櫳棟櫨櫟欄樹棲樣欒桊椏橈楨檔榿橋樺檜槳樁夢檮棶檢欞槨櫝槧橢樓欖榲榆櫬櫚櫸檟檻檳櫧橫檣櫻櫫櫥櫓櫞簷檁歡歟歐殲殤殘殞殮殫殯毆轂畢斃氈毿氌氣氫氬氳汆彙漢汙湯洶瀋溝沒灃漚瀝淪滄渢溈滬沵濘注淚澩瀧瀘濼瀉潑澤涇潔灑窪浹淺漿澆濁測澮濟瀏渾滸濃潯濤澇淶漣潿渦渙滌潤澗漲澀澱淵淥漬瀆漸澠漁瀋滲溫灣濕潰濺漵潷滾滯灩灄滿瀅濾濫灤濱灘澦濫瀠瀟瀲濰潛瀦瀾瀨瀕灝滅燈靈災燦煬爐燉煒熗點煉熾爍爛烴燭煙煩燒燁燴燙燼熱煥燜燾煆糊溜愛爺牘犛牽犧犢犋犭狀獷獁猶狽麃獮獰獨狹獅獪猙獄猻獫獵獼玀豬貓蝟獻獺璣璵瑒瑪瑋環現瑲璽琺瓏璫琿璡璉瑣瓊瑤璦璿瓔瓚甕甌電畫暢疇癤療瘧癘瘍鬁瘡瘋皰屙癰痙癢瘂癆癇痰癡癉瘮瘞瘺癟癱癮癭癩癬癲皚皺皸盞鹽監蓋盜盤瞘眥瞼睜睞瞼瞞矚矯磯礬礦碭碼磚硨硯碸礪礱礫礎碩硤磽磑礄確鹼礙磧磣堿镟磙磁磅礴禮禕禎禱禍稟祿禪離禿稈種積稱穢穠穭稅穌穩穡窮竊竅窯竄窩窺竇窶豎競篤筍筆筧箋籠籩築篳篩簹箏籌篔簽簡籙簀篋籜籮簞簫簣簍籃籬籪籟糴類秈糶糲粵糞糧糝餱緊縶糹糾紆紅紂纖紇約級紈纊紀紉緯紜紘純紕紗綱納紝縱綸紛紙紋紡紵紖紐紓線紺絏紱練組紳細織終縐絆紼絀紹繹經紿綁絨結絝繞絰絎繪給絢絳絡絕絞統綆綃絹繡綌綏絛繼綈績緒綾續綺緋綽緔緄繩維綿綬繃綢綯綹綣綜綻綰綠綴緇緙緗緘緬纜緹緲緝縕繢緦緞緶線緱縋緩締縷編緡緣縉縛縟縝縫縞纏縭縊縑繽縹縵縲纓縮繆繅纈繚繕繒繮繾繰繯繳纘罌網羅罰罷羆羈羥翹耮耬聳聶聾職聹聯聵聰肅腸膚膁腎腫脹脅膽背朧腖臚脛膠脈膾髒臍腦膿臠腳脫腡臉脾臘腋醃腐腑膕齶膩靦膃騰臏齶膪臌臟臨臺與興舉舊時會機權親觀見觀規覓視覘覽覺覬覡覿覦覯覲覷觴觸觶訁計訂訃認譏訐訌討讓訕訖訓議訊記講諱謳詎訝訥許訛論訟諷設訪訣證詁訶評詛識詐訴診詆謅詞詘詔譯詒誆誄試詿詩詰詼誠誅詵話誕詬詮詭詢詣諍該詳詫諢詡誡誣語誚誤誥誘誨誑說誦請諸諏諾讀諑誹課諉諛誰諗調諂諒諄誶談誼謀諶諜謊諫諧謔謁謂諤諭諼讒諮諳諺諦謎諞謨讜謖謝謠謗諡謙謐謹謾謫譾謬譚譖譙讕譜譎讞譴譫讖穀豉豚貝貞負貢財責賢敗賬貨質販貪貧貶購貯貫貳賤賁貰貼貴貺貸貿費賀貽賊贄賈賄貲賃賂贓資賅贐賕賑賚賒賦賭齎贖賞賜贔賙賡賠賧賴賵贅賻賺賽賾贗讚贈贍贏贛趙趕起趨趲躉躍蹌蹠躒躋踴躊蹤躓躑躡蹣躕躥躪軋軌軒軑軔轉軛輪軟轟軲軻轤軸軹軼軤軫轢軺輕軾載輊轎輈輇輅較輒輔輛輦輩輝輥輞輬輟輜輳輻輯轀輸轡轅轄輾轆轍轔辭闢辯辮邊遼達遷過邁運還這進遠違連遲邇逕跡選遜遞邐邏遺遙鄧鄺鄔郵鄒鄴鄰鬱郟鄭鄆酈鄖鄲醞醱醬釅釃釀釋鑒鑾鏨針釘釗釙釕釷釺釧釤釩釣鍆釹鈳釵鈣鈈鈦鈍鈔鍾鈉鋇鋼鈑鈐鑰欽鈞鎢鉤鈧鈁鈥鈄鈕鈀鈺錢鉦鉗鈷缽鉕鈸鉞鑽鉬鉭鉀鈿鈾鐵鉑鈴鑠鉛鉚鈰鉉鉈鉍鈮鈹鐸鉶銬銠鉺銪鋏鋣鐃銍鐺銅鋁銱銦鎧鍘銖銑鋌銩銛鏵銓鎩鉿銚鉻銘錚銫鉸銥鏟銃鐋銨銀銣鑄鐒鋪鋙錸鋱鏈鏗銷鎖鋰鋥鋤鍋鋯鋨鏽銼鋝鋒鋅鐦鐧銳銻鋃鋟鋦錒錆鍺錯錨錛錡鍀錁錕錫錮鑼錘錐錦鍁錈鍃錇錟錠鍵鋸錳錙鍥鍈鍇鏘鍶鍔鍤鍬鍾鍛鎪鍠鍰鎄鍍鎂鏤鎡鐨鎇鏌鎮鎛鎘鑷钂鐫鎳鎿鎦鎬鎊鎰鎵鑌鎔鏢鏜鏝鏰鏞鏡鏑鏃鏇鏐鐔钁鐐鏷鑥鐓鑭鐠鑹鏹鐙鑊鐳鐲鐮鐿鑔鑣鑲長門閂閃閆閈閉問闖閏闈閑閎間閔閌悶閘鬧閨聞闥閩閭闓閥閣閡閫鬮閱閬闍閾閹閶鬩閿閽閻閼闡闌闃闠闊闋闔闐闒闕闞闤隊陽陰陣階際陸隴陳陘陝隉隕險隨隱隸雋難雛讎靂霧霽黴靄靚靜麵靨韃鞽韉韋韌韓韙韞韜韻頁頂頃頇項順須頊頑顧頓頎頒頌頏預顱領頗頸頡頰頲頜潁熲頦頤頻頹頷穎顆題顒顎顓顏額顳顢顛顙顥顬顫颒風颺颭颮颯颶颸颼颻飀飄飆飈飛饗饜飠飣饑飥餳飩餼飪飫飭飯飲餞飾飽飼飿飴餌饒餉餄餎餃餏餅餑餖餓餘餒餕餜餛餡館餷饋餶餿饞饁饃餺餾饈饉饅饊饌饢馬馭馱馴馳驅馹駁驢駔駛駟駙駒騶駐駝駑駕驛駘驍罵駰驕驊駱駭駢驫驪騁驗騂駸駿騏騎騍騅騌驌驂騙騭騤騷騖驁騮騫騸驃騾驄驏驟驥驤骨髏髖髕鬢鬹魚魛魢魷魨魯魴䰾鮁鮃鯰鱸鮋鮓鮒鮊鮑鱟鮍鮐鮭鮚鮪鮞鮦鰂鮜鱠鱭鮫鮮鮺鱘鯁鱺鰱鰹鯉鰣鰷鯀鯊鯇鮶鯽鯒鯖鯪鯕鯫鯡鯤鯧鯝鯢鯛鯨鯵鯴鯔鱝鰈鰏鱨鯷鰮鰃鰓鱷鰍鰒鰉鰁鱂鯿鰠鰲鰭鰨鰥鰩鰟鰜鰳鰾鱈鱉鰻鰵鱅鰼鱖鱔鱗鱒鱯鱤鱧鱣鳥鳩雞鳶鳴鳲鷗鴉鶬鴇鴆鴣鶇鸕鴨鴞鴦鴒鴟鴝鴛鴬鴕鷥鷙鴯鴰鵂鴴鵃鴿鸞鴻鵐鵓鸝鵑鵠鵝鵒鷳鵜鵡鵲鶓鵪鵾鵯鵬鶉鶊鵷鷫鶘鶡鶚鶻鶖鶿鶥鶩鷊鷂鶲鶹鶺鷁鶼鶴鷖鸚鷓鷚鷯鷦鷲鷸鷺䴉鸇鷹鸌鸏鸛鸘鹵鹺麥麩黃黌黶黷黲黽齊齏齒齔齕齗齟齡齙齠齜齦齬齪齲齷龍龔龕龜";

  const S2T = {};
  for (let i = 0; i < S.length && i < T.length; i++) {
    if (S.charAt(i) !== T.charAt(i)) S2T[S.charAt(i)] = T.charAt(i);
  }

  function toTraditional(text) {
    return String(text || "")
      .split("")
      .map((ch) => S2T[ch] || ch)
      .join("");
  }
  root.toTraditional = toTraditional;

  function t(key) {
    if (root.QALang && typeof root.QALang.t === "function") return root.QALang.t(key);
    return key;
  }

  function newsKey() {
    const pack = root.QALang && root.QALang.current ? root.QALang.current() : "en";
    if (pack === "zh-CN" || pack === "zh-Hans") return "zh-Hans";
    if (pack === "zh-Hant" || pack === "zh-TW") return "zh-Hant";
    return "en";
  }

  function localeFor(key) {
    if (key === "zh-Hans") return "zh-CN";
    if (key === "zh-Hant") return "zh-TW";
    return "en-US";
  }

  function hhmm(epoch, key) {
    const d = new Date(Number(epoch) * 1000);
    const now = isFinite(d.getTime()) ? d : new Date();
    try {
      return now.toLocaleTimeString(localeFor(key), { hour: "2-digit", minute: "2-digit", hour12: false });
    } catch {
      const p = (n) => String(n).padStart(2, "0");
      return p(now.getHours()) + ":" + p(now.getMinutes());
    }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const NEWS_SOURCES = {
    en: {
      endpoint: CC + "EN",
      parser: (data) =>
        (data.Data || []).slice(0, 10).map((item) => ({
          time: item.published_on,
          title: item.title,
          url: item.url,
          source: (item.source_info && item.source_info.name) || "CryptoCompare",
        })),
    },
    "zh-Hans": {
      endpoint: CC + "ZH",
      parser: (data) =>
        (data.Data || []).slice(0, 10).map((item) => ({
          time: item.published_on,
          title: item.title,
          url: item.url,
          source: (item.source_info && item.source_info.name) || "中文快讯",
        })),
    },
    "zh-Hant": {
      endpoint: CC + "ZH",
      parser: (data) =>
        (data.Data || []).slice(0, 10).map((item) => ({
          time: item.published_on,
          title: toTraditional(item.title),
          url: item.url,
          source: "動區即時快訊",
        })),
    },
  };

  function fallbackItems(key) {
    return [1, 2, 3, 4, 5].map((n, i) => ({
      title: key === "zh-Hant" ? toTraditional(t("flashFb" + n)) : t("flashFb" + n),
      url: "https://www.coindesk.com/",
      time: Date.now() / 1000 - i * 600,
      source: key === "en" ? "Desk" : key === "zh-Hans" ? "中文快讯" : "動區即時快訊",
    }));
  }

  async function pullCc(key) {
    const src = NEWS_SOURCES[key] || NEWS_SOURCES.en;
    const res = await fetch(src.endpoint, { cache: "no-store" });
    if (!res.ok) throw new Error("cc");
    const json = await res.json();
    return src.parser(json).filter((x) => x.title);
  }

  async function pullRss(key) {
    const res = await fetch(RSS, { cache: "no-store" });
    if (!res.ok) throw new Error("rss");
    const json = await res.json();
    const rows = Array.isArray(json.items) ? json.items : [];
    return rows.slice(0, 10).map((row) => {
      let title = row.title || "";
      if (key === "zh-Hant") title = toTraditional(title);
      return {
        title,
        url: row.link || row.url || "#",
        time: row.pubDate ? new Date(row.pubDate).getTime() / 1000 : Date.now() / 1000,
        source: row.author || "RSS",
      };
    }).filter((x) => x.title);
  }

  function paintNews(items, key) {
    const list = document.getElementById("flashNews");
    if (!list) return;
    const live = items && items.length;
    const rows = live ? items : fallbackItems(key);
    list.dataset.fallback = live ? "0" : "1";
    list.dataset.lang = key;
    list.innerHTML = rows
      .map((it) => {
        const clock = typeof it.time === "string" ? it.time : hhmm(it.time, key);
        const src = it.source ? `<em class="flash-src">${escapeHtml(it.source)}</em>` : "";
        return (
          `<li><a class="flash-row" href="${escapeHtml(it.url)}" target="_blank" rel="noopener noreferrer">` +
          `<time>[ ${clock} ]</time>` +
          `<span>${escapeHtml(it.title)}</span>${src}` +
          `</a></li>`
        );
      })
      .join("");
  }

  let newsTimer = 0;
  let scrollTimer = 0;
  let newsReq = 0;

  async function refreshNews() {
    const key = newsKey();
    const req = ++newsReq;
    try {
      let items = [];
      try {
        items = await pullCc(key);
      } catch {
        items = await pullRss(key);
      }
      if (req !== newsReq) return;
      paintNews(items.slice(0, 10), key);
    } catch {
      if (req !== newsReq) return;
      paintNews(fallbackItems(key), key);
    }
  }

  function startScroll() {
    const list = document.getElementById("flashNews");
    if (!list) return;
    let dir = 1;
    clearInterval(scrollTimer);
    scrollTimer = setInterval(() => {
      if (list.matches(":hover")) return;
      const max = list.scrollHeight - list.clientHeight;
      if (max <= 0) return;
      list.scrollTop += dir;
      if (list.scrollTop >= max) dir = -1;
      if (list.scrollTop <= 0) dir = 1;
    }, 80);
  }

  function parsePct(raw) {
    const n = parseFloat(String(raw || "").replace(/[^0-9.+-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function weekRows() {
    const cards = document.querySelectorAll("#gridAll .m-card");
    const live = [];
    cards.forEach((card) => {
      const ret = Number(card.getAttribute("data-ret"));
      const name = ((card.querySelector("h3") || {}).textContent || "").trim();
      const id = card.getAttribute("data-id") || "";
      if (name && Number.isFinite(ret) && Math.abs(ret) > 0.0001) {
        live.push({ id, name, pct: ret * 100 });
      }
    });
    if (live.length >= 3) return live.sort((a, b) => b.pct - a.pct).slice(0, 5);
    const list = (root.QACatalog && root.QACatalog.list) || [];
    return list
      .filter((s) => s && s.id && s.id !== "ai")
      .map((s) => {
        const m = s.metrics || {};
        return { id: s.id, name: s.name, pct: parsePct(m.best_return || m.week_return || m.total_return) };
      })
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5);
  }

  function paintWeek() {
    const rows = weekRows();
    const html = rows.length
      ? rows
          .map((row, i) => {
            const sign = row.pct >= 0 ? "+" : "";
            const cls = row.pct >= 0 ? "up" : "down";
            return (
              `<li><button type="button" class="week-row" data-open-week="${escapeHtml(row.id)}">` +
              `<b>${i + 1}</b><span>${escapeHtml(row.name)}</span>` +
              `<em class="${cls}">${sign}${row.pct.toFixed(1)}%</em>` +
              `</button></li>`
            );
          })
          .join("")
      : `<li class="muted">${escapeHtml(t("weekBoardEmpty"))}</li>`;
    document.querySelectorAll("[data-week-board]").forEach((el) => {
      el.innerHTML = html;
    });
  }

  function bindWeekClicks() {
    document.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest && e.target.closest("[data-open-week]");
      if (!btn) return;
      const id = btn.getAttribute("data-open-week");
      const open = document.querySelector('#gridAll [data-open="' + id + '"]');
      if (open) open.click();
    });
  }

  function watchWeek() {
    const grid = document.getElementById("gridAll");
    if (!grid || typeof MutationObserver === "undefined") return;
    const ob = new MutationObserver(() => paintWeek());
    ob.observe(grid, { subtree: true, attributes: true, attributeFilter: ["data-ret"], childList: true });
  }

  function bootNews() {
    if (!document.getElementById("flashNews")) return;
    paintNews(fallbackItems(newsKey()), newsKey());
    refreshNews();
    startScroll();
    clearInterval(newsTimer);
    newsTimer = setInterval(refreshNews, POLL_MS);
  }

  function bootWeek() {
    paintWeek();
    bindWeekClicks();
    watchWeek();
    if (root.QAPackReady && typeof root.QAPackReady.then === "function") {
      root.QAPackReady.then(() => paintWeek()).catch(() => paintWeek());
    }
    setTimeout(paintWeek, 1200);
    setTimeout(paintWeek, 4000);
  }

  root.addEventListener("quant-lang", () => {
    refreshNews();
    paintWeek();
  });

  function boot() {
    bootNews();
    bootWeek();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
