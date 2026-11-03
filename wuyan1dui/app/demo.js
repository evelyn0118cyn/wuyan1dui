/**
 * 无言以队 · 演示数据集生成器（PRELOAD_DEMO）
 *
 * 生成与 MySQL `datatest` 26 张业务表【字段结构完全一致】的离线演示数据，
 * 并按 Prompt 文档要求植入以下可疑样本：
 *   ① 1 个可疑供应商（S028 安徽宏远机电设备有限公司）
 *        - 拆分付款：同一天把 1 笔大额拆成 4 笔，单笔压在 10 万元审批线下
 *        - 资金回流：向 S028 付款后 21 天内收到其法定代表人个人账户回流款项
 *        - 关联交易：S028 与本公司采购专员共用联系电话；实控人姓名与本司员工重名
 *        - 价格偏高：采购单价显著高于物料基准价
 *        - 三单不匹配：PO-202606-0031 无入库单（有票无货）、PO-202606-0033 入库早于订单
 *   ② 1 个可疑员工（EMP031 罗建国，采购专员）
 *        - 长期单一对接 S028
 *        - 报销金额与凭证不符、月末集中报销
 *        - 审批链仅 1 级（补签）
 *   ③ 若干拆分付款与资金回流样例（S028、S055）
 *   ④ 三单不匹配样例（无入库、日期倒挂、金额不一致）
 *   ⑤ 银企未达账项样例（voucher_id 为空、matched=0）
 *
 * 数据固定种子，可复现；不依赖网络。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WyDemo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------- 固定种子伪随机（可复现） ---------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rnd = mulberry32(20261102);
  const R = (min, max) => min + rnd() * (max - min);
  const RI = (min, max) => Math.floor(R(min, max + 1));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const round2 = (n) => Math.round(Number(n) * 100) / 100;
  const pad = (n, w) => String(n).padStart(w, '0');
  const dstr = (y, m, d) => `${y}-${pad(m, 2)}-${pad(d, 2)}`;
  const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
  const dayOfWeek = (y, m, d) => new Date(y, m - 1, d).getDay(); // 0=周日

  /* 演示数据统一落在 2026 会计年度内：越界日期回收到 2026-12-28 */
  const CLAMP_END = Date.UTC(2026, 11, 28);
  const CLAMP_START = Date.UTC(2026, 0, 2);
  function clampYear(date) {
    const t = date.getTime();
    if (t > CLAMP_END) return new Date(CLAMP_END);
    if (t < CLAMP_START) return new Date(CLAMP_START);
    return date;
  }
  const ds = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}T16:00:00.000Z`;

  const YEAR = 2026;
  const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  /* ---------- 主数据：部门 ---------- */
  const DEPTS = [
    ['D001', '总裁办公室', ''], ['D002', '董事会秘书处', 'D001'], ['D003', '监事会办公室', ''],
    ['D004', '财务部', ''], ['D005', '资金管理中心', 'D004'], ['D006', '会计核算部', 'D004'],
    ['D007', '税务管理部', 'D004'], ['D008', '人力资源部', ''], ['D009', '薪酬绩效部', 'D008'],
    ['D010', '采购部', ''], ['D011', '采购一部', 'D010'], ['D012', '采购二部', 'D010'],
    ['D013', '销售部', ''], ['D014', '销售一部', 'D013'], ['D015', '销售二部', 'D013'],
    ['D016', '生产部', ''], ['D017', '仓储部', 'D016'], ['D018', '研发部', ''],
    ['D019', '研发一部', 'D018'], ['D020', '研发二部', 'D018'], ['D021', '质量管理部', ''],
    ['D022', '审计部', ''], ['D023', '法务部', ''], ['D024', '信息技术部', ''],
    ['D025', '生产一部', 'D016'], ['D026', '生产二部', 'D016'], ['D027', '设备部', 'D016'],
    ['D028', '市场部', ''], ['D029', '客服部', ''], ['D030', '供应链管理部', '']
  ];

  /* ---------- 主数据：员工（含 1 个可疑员工 EMP031） ---------- */
  const EMP_SEED = [
    ['EMP001', '韩志国', 'D001', '总裁', '1201199411096199', '6222579060399646', '2010-11-08'],
    ['EMP002', '王海涛', 'D001', '副总裁', '1201199305275125', '6222542602823618', '2010-05-26'],
    ['EMP003', '周莉', 'D001', '总裁助理', '1201199109033853', '6222762841110835', '2014-09-02'],
    ['EMP004', '萧刚', 'D002', '董事会秘书', '1201198108189797', '6222080951215919', '2018-08-17'],
    ['EMP005', '梁秀兰', 'D004', '财务总监', '1201198211111432', '6222168417692852', '2013-11-10'],
    ['EMP006', '丁建国', 'D006', '财务经理', '1201199909043034', '6222672729557662', '2016-03-14'],
    ['EMP007', '程润物', 'D006', '高级会计', '1201199103157841', '6222275912528737', '2019-07-21'],
    ['EMP008', '阎秀兰', 'D005', '出纳', '1201198307182476', '6222022662886492', '2015-05-09'],
    ['EMP009', '宋子豪', 'D007', '税务主管', '1201198212246157', '6222432013255453', '2017-09-01'],
    ['EMP010', '马若虚', 'D005', '资金经理', '1201199709197954', '6222193852205083', '2020-02-18'],
    ['EMP011', '吴晓梅', 'D006', '总账会计', '1201198804126872', '6222452810937461', '2014-08-25'],
    ['EMP012', '郑海峰', 'D006', '成本会计', '1201199006114589', '6222819427365510', '2018-04-11'],
    ['EMP013', '孙立群', 'D006', '应付会计', '1201198707229465', '6222093357486122', '2012-10-30'],
    ['EMP014', '许静怡', 'D006', '应收会计', '1201199501183547', '6222356194802735', '2021-01-18'],
    ['EMP015', '何志强', 'D022', '审计部经理', '1201198409305218', '6222481937562049', '2013-06-07'],
    ['EMP016', '林嘉怡', 'D013', '销售总监', '1201198911127463', '6222648591370248', '2015-11-23'],
    ['EMP017', '曹俊杰', 'D014', '销售经理', '1201199206189452', '6222157384920613', '2019-03-05'],
    ['EMP018', '张彦博', 'D015', '销售经理', '1201199103052846', '6222305918673421', '2018-08-14'],
    ['EMP019', '李佳琪', 'D028', '市场总监', '1201199408221563', '6222722694851037', '2020-07-03'],
    ['EMP020', '刘明轩', 'D028', '品牌经理', '1201199604028531', '6222091376458209', '2021-05-26'],
    ['EMP021', '陈思颖', 'D008', '人力资源总监', '1201198602197468', '6222558139270642', '2012-03-19'],
    ['EMP022', '杨翰林', 'D009', '薪酬绩效经理', '1201199307126851', '6222294716503827', '2019-09-16'],
    ['EMP023', '黄志远', 'D024', 'IT经理', '1201198810274536', '6222639841025734', '2014-12-08'],
    ['EMP024', '赵婉如', 'D024', '系统管理员', '1201199512089457', '6222173629485016', '2021-08-23'],
    ['EMP025', '蒋润物', 'D024', 'IT运维专员', '1201199011213578', '6222462918357409', '2017-04-25'],
    ['EMP026', '周文博', 'D018', '研发总监', '1201198705318642', '6222819472650314', '2012-07-12'],
    ['EMP027', '傅思远', 'D019', '高级工程师', '1201199102226718', '6222702384915672', '2018-02-27'],
    ['EMP028', '朱雨桐', 'D020', '研发工程师', '1201199611174823', '6222036487519264', '2021-11-15'],
    ['EMP029', '谢志刚', 'D016', '生产总监', '1201198508231697', '6222429175630821', '2011-09-26'],
    ['EMP030', '罗建国', 'D010', '采购总监', '1201197905156278', '6222331749506187', '2010-04-19'],
    /* —— 可疑员工 —— */
    ['EMP031', '沈立国', 'D011', '采购专员', '1201199007183296', '6222761584930172', '2019-06-10'],
    ['EMP032', '钱佩华', 'D011', '采购专员', '1201199208261543', '6222087193465028', '2020-03-03'],
    ['EMP033', '顾春燕', 'D012', '采购专员', '1201199405197826', '6222652841709365', '2021-12-06'],
    ['EMP034', '孟凡超', 'D012', '采购经理', '1201198912048753', '6222196470831524', '2016-05-16'],
    ['EMP035', '尹婉秋', 'D017', '仓储经理', '1201199306184729', '6222508374619253', '2019-10-21'],
    ['EMP036', '汤志明', 'D021', '质量工程师', '1201199111053274', '6222914823654071', '2018-01-09'],
    ['EMP037', '汪春华', 'D023', '法务经理', '1201198803179512', '6222245731086948', '2014-11-03'],
    ['EMP038', '贾立新', 'D025', '事业部总经理', '1201198310146275', '6222583194762015', '2013-02-11'],
    ['EMP039', '范晓东', 'D027', '设备部经理', '1201199004183671', '6222458617920384', '2018-07-30'],
    ['EMP040', '李海燕', 'D026', '生产总监', '1201198906092748', '6222639140287516', '2015-08-04'],
    ['EMP041', '毛建国', 'D029', '客服部经理', '1201199208145932', '6222715364098273', '2019-04-15'],
    ['EMP042', '邱晓峰', 'D030', '供应链经理', '1201199012286745', '6222864920715368', '2017-12-19']
  ];

  /* ---------- 主数据：供应商 ---------- */
  const SUP_SEED = [
    ['S001', '东莞五金精密制造有限公司', '91339198991X000000', '刘秀英', '13800138001', '东莞市长安镇振安路251号', 'N60'],
    ['S002', '佛山钢材贸易有限公司', '91728002788X000000', '何超', '13800138002', '佛山市禅城区季华路81号', 'M30'],
    ['S003', '深圳电子元器件供应有限公司', '91718485373X000000', '董国强', '13800138003', '深圳市福田区华强北路372号', 'N90'],
    ['S004', '上海化学品原料有限公司', '91137149968X000000', '刘礼信', '13800138004', '上海市金山区亭卫公路414号', 'N60'],
    ['S005', '广州包装材料制品有限公司', '91976417145X000000', '周欣怡', '13800138005', '广州市白云区机场路447号', 'N90'],
    ['S006', '杭州标准件供应有限公司', '91370407039X000000', '彭伟杰', '13800138006', '杭州市萧山区金城路877号', 'N60'],
    ['S007', '北京精密仪器仪表有限公司', '91990475812X000000', '周丽华', '13800138007', '北京市海淀区知春路802号', 'N30'],
    ['S008', '宁波塑料制品有限公司', '91988260728X000000', '蒋润物', '13800138008', '宁波市鄞州区天童路559号', '预付30%'],
    ['S009', '苏州铝合金型材公司', '91910482106X000000', '王振国', '13800138009', '苏州市吴中区东吴南路120号', 'N60'],
    ['S010', '天津钢管集团销售公司', '91120561893X000000', '李卫东', '13800138010', '天津市东丽区津塘路900号', 'N90'],
    ['S011', '青岛轴承有限公司', '91370200347X000000', '孙丽娟', '13800138011', '青岛市市北区辽阳西路318号', 'N30'],
    ['S012', '无锡机床附件厂', '91320209185X000000', '张建华', '13800138012', '无锡市滨湖区胡埭路66号', 'N60'],
    ['S013', '常州柴油机配件公司', '91320400752X000000', '陈志刚', '13800138013', '常州市武进区湖塘镇127号', 'N60'],
    ['S014', '南京化纤原料有限公司', '91320100491X000000', '赵敏', '13800138014', '南京市江宁区秣周东路88号', 'M30'],
    ['S015', '合肥电气元件公司', '91340100126X000000', '吴红梅', '13800138015', '合肥市蜀山区望江西路203号', 'N60'],
    ['S016', '郑州金属材料有限公司', '91410100938X000000', '周大勇', '13800138016', '郑州市金水区花园路45号', 'N90'],
    ['S017', '武汉模具制造有限公司', '91420100784X000000', '刘波', '13800138017', '武汉市江汉区解放大道512号', 'N30'],
    ['S018', '宝钢集团销售有限公司', '91310000617X000000', '朱国平', '13800138018', '上海市宝山区宝杨路778号', 'N90'],
    ['S019', '长治液压件有限公司', '91140400062X000000', '李惠芳', '13800138019', '长治市城区太行西街33号', 'N60'],
    ['S020', '洛阳轴承科技股份有限公司', '91410300815X000000', '郭建军', '13800138020', '洛阳市涧西区中州西路210号', 'N60'],
    ['S021', '西安高压电器有限公司', '91610100473X000000', '杨雪梅', '13800138021', '西安市雁塔区科技路168号', 'M30'],
    ['S022', '兰州石化设备制造有限公司', '91620100258X000000', '马志强', '13800138022', '兰州市西固区福利路91号', 'N60'],
    ['S023', '重庆两江工业设备有限公司', '91500100946X000000', '唐小燕', '13800138023', '重庆市渝北区龙溪街道67号', 'N90'],
    ['S024', '成都金属加工材料有限公司', '91510100537X000000', '严永康', '13800138024', '成都市龙泉驿区车城东七路18号', 'N60'],
    ['S025', '昆明有色金属贸易公司', '91530100719X000000', '段丽萍', '13800138025', '昆明市盘龙区北京路382号', 'N30'],
    ['S026', '长沙工程机械配件公司', '91430100826X000000', '谭志伟', '13800138026', '长沙市岳麓区枫林三路155号', 'N60'],
    ['S027', '河北敬业集团销售公司', '91130100974X000000', '吕梦琪', '13800138027', '石家庄市裕华区体育南大街274号', 'N90'],
    /* —— 可疑供应商 —— */
    ['S028', '安徽宏远机电设备有限公司', '91340100782X000000', '沈立国', '13905678912', '合肥市包河区徽州大道238号702室', '预付50%'],
    ['S029', '福建厦门工贸有限公司', '91350200815X000000', '陈建辉', '13800138029', '厦门市思明区湖滨南路49号', 'N60'],
    ['S030', '江苏武进不锈泵阀', '91320412107X000000', '梁明', '13800138030', '常州市武进区横林镇89号', 'N60'],
    ['S031', '浙江久立特材科技', '91330500136X000000', '郑伟东', '13800138031', '湖州市长兴县雉城路521号', 'N90'],
    ['S032', '万华化学供应公司', '91370600284X000000', '刘长胜', '13800138032', '烟台市芝罘区化工路9号', 'N60'],
    ['S033', '太钢不锈销售有限公司', '91140100491X000000', '张少华', '13800138033', '太原市尖草坪区解放北路346号', 'N90'],
    ['S034', '福耀玻璃工业集团', '91350100153X000000', '曹德旺', '13800138034', '福清市融侨经济技术开发区60号', 'N60'],
    ['S035', '正泰电器股份公司', '91330000146X000000', '南存辉', '13800138035', '温州市乐清市柳市镇振华路1号', 'M30'],
    ['S036', '天正电气股份公司', '91330000257X000000', '高天乐', '13800138036', '温州市乐清市经济开发区15号', 'N60'],
    ['S037', '信捷电气股份公司', '91320200168X000000', '李新', '13800138037', '无锡市新吴区长江南路22号', 'N60'],
    ['S038', '万向钱潮股份公司', '91330100194X000000', '鲁冠球', '13800138038', '杭州市萧山区宁围镇75号', 'N90'],
    ['S039', '本钢集团贸易公司', '91210500123X000000', '张晓光', '13800138039', '本溪市平山区人民路38号', 'N60'],
    ['S040', '沙钢集团贸易有限公司', '91320500174X000000', '沈文荣', '13800138040', '张家港市锦丰镇110号', 'N90'],
    ['S041', '天津友发钢管集团', '91120100862X000000', '李金', '13800138041', '天津市静海区大邱庄镇211号', 'N60'],
    ['S042', '中鼎股份密封件公司', '91340200291X000000', '夏鼎湖', '13800138042', '宁国市经济技术开发区46号', 'M30'],
    ['S043', '银宝山新科技公司', '91440300573X000000', '曾世杰', '13800138043', '深圳市宝安区石岩街道28号', 'N60'],
    ['S044', '赛轮轮胎股份公司', '91370200748X000000', '李海燕', '13800138044', '青岛市黄岛区茂山路18号', 'N90'],
    ['S045', '首钢集团供销公司', '91210100839X000000', '王青海', '13800138045', '沈阳市铁西区兴工北街63号', 'N60'],
    ['S046', '嘉兴紧固件集团有限公司', '91330400157X000000', '徐建平', '13800138046', '嘉兴市南湖区中环南路92号', 'N30'],
    ['S047', '温州乐清电气有限公司', '91330300146X000000', '叶建华', '13800138047', '乐清市柳市镇兴业路33号', 'N60'],
    ['S048', '杭州力洋贸易商行', '91330100125X000000', '许志远', '13800138048', '杭州市拱墅区莫干山路177号', 'N60'],
    ['S049', '深圳市前海万通贸易有限公司', '91440300217X000000', '方海波', '13800138049', '深圳市前海深港合作区前湾一路1号', '预付100%'],
    ['S050', '上海泰和商务咨询有限公司', '91310100114X000000', '徐国华', '13800138050', '上海市浦东新区张杨路368号', 'N30']
  ];

  /* ---------- 主数据：客户 ---------- */
  const CUS_SEED = [
    ['C001', '深圳智造科技有限公司', '91620103699X000000', '邓晓红', '13700137001', '深圳市南山区科技园南路328号', 'A级'],
    ['C002', '广州天河电子有限公司', '91406087667X000000', '谢子轩', '13700137002', '广州市天河区天河路615号', 'A级'],
    ['C003', '北京中科仪器股份有限公司', '91544952599X000000', '冯梦琪', '13700137003', '北京市朝阳区北苑路605号', 'AAA'],
    ['C004', '上海华昌自动化设备有限公司', '91417319186X000000', '陈思远', '13700137004', '上海市浦东新区华夏中路785号', 'A级'],
    ['C005', '成都西部光电科技有限公司', '91335710247X000000', '魏玲', '13700137005', '成都市高新区天府大道474号', 'B级'],
    ['C006', '南京江宁智能制造有限公司', '91320100891X000000', '刘振华', '13700137006', '南京市江宁区将军大道56号', 'A级'],
    ['C007', '无锡先导智能装备股份有限公司', '91320200763X000000', '王晓峰', '13700137007', '无锡市新吴区长江东路288号', 'AAA'],
    ['C008', '武汉东湖精密机械有限公司', '91420100384X000000', '李明辉', '13700137008', '武汉市东湖新技术开发区光谷大道303号', 'A级'],
    ['C009', '常州维尔利环保设备公司', '91320400971X000000', '周建国', '13700137009', '常州市新北区高新科技园58号', 'A级'],
    ['C010', '苏州赛腾精密电子股份公司', '91320500572X000000', '孙权', '13700137010', '苏州市工业园区星湖街218号', 'AAA'],
    ['C011', '重庆两江智能装备有限公司', '91500100419X000000', '何勇', '13700137011', '重庆市渝北区金开大道98号', 'A级'],
    ['C012', '杭州海康智能科技公司', '91330100124X000000', '陈宗年', '13700137012', '杭州市滨江区东流路700号', 'AAA'],
    ['C013', '合肥京东方显示技术公司', '91340100567X000000', '王东升', '13700137013', '合肥市新站区铜陵北路2177号', 'AAA'],
    ['C014', '西安陕鼓动力股份公司', '91610100258X000000', '印建安', '13700137014', '西安市高新区锦业路78号', 'A级'],
    ['C015', '天津滨海通信器材有限公司', '91120100694X000000', '李振宇', '13700137015', '天津市滨海新区第五大街19号', 'B级'],
    ['C016', '石家庄冀中能源装备公司', '91130100286X000000', '张文学', '13700137016', '石家庄市桥西区中山西路258号', 'A级'],
    ['C017', '太原重工装备制造公司', '91140100195X000000', '王创民', '13700137017', '太原市万柏林区玉河街53号', 'A级'],
    ['C018', '沈阳机床智能装备公司', '91210100617X000000', '关锡友', '13700137018', '沈阳市经济技术开发区开发大路17号', 'B级'],
    ['C019', '大连高新测量仪器有限公司', '91210200538X000000', '曲道奎', '13700137019', '大连市高新园区七贤岭29号', 'A级'],
    ['C020', '青岛海尔智能装备公司', '91370200289X000000', '周云杰', '13700137020', '青岛市崂山区海尔路1号', 'AAA'],
    ['C021', '烟台迈瑞医疗设备有限公司', '91370600174X000000', '李西廷', '13700137021', '烟台市开发区长江路296号', 'AAA'],
    ['C022', '郑州宇通工业自动化公司', '91410100816X000000', '汤玉祥', '13700137022', '郑州市管城区宇通路6号', 'A级'],
    ['C023', '洛阳中信重工机械公司', '91410300127X000000', '俞章法', '13700137023', '洛阳市涧西区建设路206号', 'A级'],
    ['C024', '南昌江铃汽车装备公司', '91360100135X000000', '邱天高', '13700137024', '南昌市青云谱区迎宾北大道509号', 'B级'],
    ['C025', '长沙中联重科装备公司', '91430100729X000000', '詹纯新', '13700137025', '长沙市岳麓区银盆南路361号', 'AAA'],
    ['C026', '株洲中车时代电气公司', '91430200742X000000', '李东林', '13700137026', '株洲市石峰区时代路169号', 'AAA'],
    ['C027', '福州马尾造船有限公司', '91350100168X000000', '黄如堂', '13700137027', '福州市马尾区昭忠路1号', 'B级'],
    ['C028', '厦门厦工智能装备公司', '91350200139X000000', '许振明', '13700137028', '厦门市集美区灌口南路668号', 'A级'],
    ['C029', '温州瑞立汽车部件公司', '91330300246X000000', '张晓平', '13700137029', '温州市瑞安市经济开发区368号', 'A级'],
    ['C030', '乌鲁木齐新能源装备有限公司', '91650100184X000000', '阿力木·吐尔逊', '13700137030', '乌鲁木齐市头屯河区工业园89号', 'B级']
  ];

  /* ---------- 物料 ---------- */
  const PROD_SEED = [
    ['M001', '不锈钢板材 304', '原材料', '吨', 1581.09, '13', '304/2B'],
    ['M002', '高强度紧固件 M12', '辅料', '千件', 420.50, '13', 'M12×60'],
    ['M003', '工业传感器模块 SM-01', '半成品', '件', 2860.00, '13', 'SM-01'],
    ['M004', 'PLC控制器 P100', '半成品', '台', 4300.00, '13', 'P100'],
    ['M005', '伺服电机 1.5kW', '原材料', '台', 3160.00, '13', 'SE-1.5'],
    ['M006', '工业网关 IG-100', '成品', '台', 2280.00, '13', 'IG-100'],
    ['M007', '精密流量计 FL-200', '成品', '台', 1490.00, '13', 'FL-200'],
    ['M008', '智能温控器 X100', '成品', '台', 780.00, '13', 'X100'],
    ['M009', '激光切割机 LC-3000', '成品', '台', 186000.00, '13', 'LC-3000'],
    ['M010', '数控机床 CNC-500', '成品', '台', 248000.00, '13', 'CNC-500'],
    ['M011', '铝合金型材 6063', '原材料', '吨', 6200.00, '13', '6063-T5'],
    ['M012', '轴承 6205-2RS', '辅料', '套', 86.00, '13', '6205-2RS'],
    ['M013', '液压阀组 HV-20', '原材料', '套', 3950.00, '13', 'HV-20'],
    ['M014', '电气控制柜 EC-800', '半成品', '台', 12800.00, '13', 'EC-800'],
    ['M015', '包装纸箱中号', '辅料', '个', 4.80, '13', '500×350×300'],
    ['M016', '环氧树脂密封胶', '原材料', '桶', 320.00, '13', '20kg/桶'],
    ['M017', '变频器 VF-110', '原材料', '台', 5400.00, '13', 'VF-110'],
    ['M018', '显示屏模组 DP-7', '原材料', '件', 680.00, '13', '7寸'],
    ['M019', '工业以太网交换机', '半成品', '台', 2150.00, '13', 'IES-08'],
    ['M020', '钣金外壳组件', '原材料', '套', 960.00, '13', '定制']
  ];

  /* ---------- 会计科目 ---------- */
  const SUBJ_SEED = [
    ['1001', '库存现金', '资产', '', 'D'], ['1002', '银行存款', '资产', '', 'D'],
    ['1002-01', '银行存款-工商银行基本户', '资产', '1002', 'D'],
    ['1002-02', '银行存款-工商银行一般户', '资产', '1002', 'D'],
    ['1012', '其他货币资金', '资产', '', 'D'],
    ['1122', '应收账款', '资产', '', 'D'],
    ['1123', '预付账款', '资产', '', 'D'],
    ['1221', '其他应收款', '资产', '', 'D'],
    ['1401', '材料采购', '资产', '', 'D'],
    ['1403', '原材料', '资产', '', 'D'],
    ['1405', '库存商品', '资产', '', 'D'],
    ['1601', '固定资产', '资产', '', 'D'],
    ['1602', '累计折旧', '资产', '', 'C'],
    ['2202', '应付账款', '负债', '', 'C'],
    ['2203', '预收账款', '负债', '', 'C'],
    ['2211', '应付职工薪酬', '负债', '', 'C'],
    ['2221-01', '应交税费-应交增值税-销项税额', '负债', '2221', 'C'],
    ['2221-02', '应交税费-应交增值税-进项税额', '负债', '2221', 'D'],
    ['2241', '其他应付款', '负债', '', 'C'],
    ['4001', '实收资本', '权益', '', 'C'],
    ['5001', '生产成本', '成本', '', 'D'],
    ['5101', '制造费用', '成本', '', 'D'],
    ['5301-01', '研发支出-费用化支出', '成本', '5301', 'D'],
    ['6001', '主营业务收入', '损益', '', 'C'],
    ['6051', '其他业务收入', '损益', '', 'C'],
    ['6401', '主营业务成本', '损益', '', 'D'],
    ['6601-01', '销售费用-差旅费', '损益', '6601', 'D'],
    ['6601-02', '销售费用-业务招待费', '损益', '6601', 'D'],
    ['6602-01', '管理费用-办公费', '损益', '6602', 'D'],
    ['6602-02', '管理费用-差旅费', '损益', '6602', 'D'],
    ['6604-02', '管理费用-咨询费', '损益', '6604', 'D'],
    ['6111', '投资收益', '损益', '', 'C']
  ];

  /* ---------- 银行账户 ---------- */
  const BANK_ACCTS = [
    ['1205-0001-2345-6789', '中国工商银行天津滨海新区支行', '基本户', 'CNY'],
    ['1205-0002-3456-7890', '中国工商银行天津开发区支行', '一般户', 'CNY'],
    ['1207-0001-8901-2345', '中国建设银行天津滨海支行', '一般户', 'CNY'],
    ['1213-0001-0123-4567', '交通银行天津滨海支行', '一般户', 'CNY']
  ];
  const MAIN_ACCT = BANK_ACCTS[0][0];

  /* ---------- 成本中心 / 项目 / 税率 ---------- */
  const CC_SEED = [
    ['CC-MFG-01', '总装一车间', 'D025', '制造'], ['CC-MFG-02', '总装二车间', 'D026', '制造'],
    ['CC-RD-01', '研发一部', 'D019', '研发'], ['CC-RD-02', '研发二部', 'D020', '研发'],
    ['CC-MGT-01', '财务管理中心', 'D004', '管理'], ['CC-SAL-01', '销售一部', 'D014', '销售']
  ];
  const PRJ_SEED = [
    ['PRJ-001', '新一代工业网关研发项目', 'D019', 'R&D', 8000000],
    ['PRJ-002', '智能温控器二代研发', 'D020', 'R&D', 5200000],
    ['PRJ-003', '产线自动化技改项目', 'D025', '技改', 3200000]
  ];
  const TAX_RATES = [
    ['13', 0.13, '增值税-标准税率13%'], ['9', 0.09, '增值税-低税率9%'],
    ['6', 0.06, '增值税-现代服务业6%'], ['0', 0.00, '增值税-出口零税率'], ['25', 0.25, '企业所得税25%']
  ];

  /* 电话/地址冲突（关联交易线索）：S028 与 S049、S050 共用联系方式 */
  const SHARED_PHONE = '13905678912';
  const SHARED_ADDR = '合肥市包河区徽州大道238号702室';

  /* ============================================================
   * 构建数据集
   * ============================================================ */
  function build() {
    const D = {
      subjects: [], cost_centers: [], departments: [], employees: [], products: [],
      customers: [], suppliers: [], tax_rates: [], projects: [], bank_accounts: [],
      gl_vouchers: [], gl_ledger: [], gl_voucher_entries: [],
      oa_expense_reports: [], oa_approval_records: [],
      pur_orders: [], pur_contracts: [], pur_order_items: [], pur_receipts: [],
      sal_orders: [], sal_deliveries: [], sal_order_items: [],
      bank_transactions: [], tax_invoice_pool: [], rd_timesheets: [], tax_vat_declarations: []
    };
    /**
     * 每张表独立主键计数：外键（po_id / voucher_id / so_id / report_id 等）
     * 直接引用目标表 id，构建期不回填、不重排，保证引用稳定。
     */
    const tableSeq = {};
    const nextIdFor = (table) => {
      tableSeq[table] = (tableSeq[table] || 0) + 1;
      return tableSeq[table];
    };
    const NOW = '2026-12-31T16:00:00.000Z';

    /* ---- 主数据 ---- */
    SUBJ_SEED.forEach(([code, name, type, parent, dir], i) => {
      D.subjects.push({ id: nextIdFor('subjects'), subject_code: code, subject_name: name, subject_type: type,
        parent_code: parent, dc_direction: dir, is_enabled: 1, created_at: '2026-01-01T00:00:00.000Z' });
    });
    CC_SEED.forEach(([code, name, dept, type], i) => {
      D.cost_centers.push({ id: nextIdFor('cost_centers'), cc_code: code, cc_name: name, dept_code: dept, cc_type: type, created_at: '2026-01-01T00:00:00.000Z' });
    });
    DEPTS.forEach(([code, name, parent], i) => {
      D.departments.push({ id: nextIdFor('departments'), dept_code: code, dept_name: name, parent_dept_code: parent, manager_emp_code: '', created_at: '2026-01-01T00:00:00.000Z' });
    });
    EMP_SEED.forEach(([code, name, dept, pos, idc, bank, hire]) => {
      D.employees.push({ id: nextIdFor('employees'), emp_code: code, emp_name: name, dept_code: dept, position: pos,
        id_card: idc, bank_account: bank, hire_date: hire + 'T16:00:00.000Z', created_at: '2026-01-01T00:00:00.000Z' });
    });
    PROD_SEED.forEach(([code, name, cat, unit, price, rate, spec]) => {
      D.products.push({ id: nextIdFor('products'), product_code: code, product_name: name, category: cat, unit,
        unit_price: round2(price), tax_rate_code: rate, spec, created_at: '2026-01-01T00:00:00.000Z' });
    });
    CUS_SEED.forEach(([code, name, tax, contact, phone, addr, credit]) => {
      D.customers.push({ id: nextIdFor('customers'), customer_code: code, customer_name: name, tax_no: tax,
        contact, phone, address: addr, credit_rating: credit, created_at: '2026-01-01T00:00:00.000Z' });
    });
    SUP_SEED.forEach(([code, name, tax, contact, phone, addr, terms]) => {
      D.suppliers.push({ id: nextIdFor('suppliers'), supplier_code: code, supplier_name: name, tax_no: tax,
        contact, phone, address: addr, payment_terms: terms, created_at: '2026-01-01T00:00:00.000Z' });
    });
    /* 关联交易植入：S049、S050 与 S028 共用电话/地址 */
    const supIdx = (code) => D.suppliers.findIndex((s) => s.supplier_code === code);
    D.suppliers[supIdx('S049')].phone = SHARED_PHONE;
    D.suppliers[supIdx('S049')].address = SHARED_ADDR;
    D.suppliers[supIdx('S050')].phone = '13905678912';
    /* S050 税号异常（不足 18 位），触发供应商准入资料不全 */
    D.suppliers[supIdx('S050')].tax_no = '91310100';
    TAX_RATES.forEach(([code, rate, desc]) => {
      D.tax_rates.push({ id: nextIdFor('tax_rates'), tax_rate_code: code, tax_rate: rate, description: desc, created_at: '2026-01-01T00:00:00.000Z' });
    });
    PRJ_SEED.forEach(([code, name, dept, type, budget]) => {
      D.projects.push({ id: nextIdFor('projects'), project_code: code, project_name: name, dept_code: dept,
        project_type: type, budget: round2(budget), start_date: '2026-01-01T16:00:00.000Z',
        end_date: '2026-12-31T16:00:00.000Z', status: '进行中', created_at: '2026-01-01T00:00:00.000Z' });
    });
    BANK_ACCTS.forEach(([no, bank, type, cur]) => {
      D.bank_accounts.push({ id: nextIdFor('bank_accounts'), account_no: no, bank_name: bank, account_type: type, currency: cur, created_at: '2026-01-01T00:00:00.000Z' });
    });

    const SUP_BY_CODE = {};
    D.suppliers.forEach((s) => { SUP_BY_CODE[s.supplier_code] = s; });
    const CUS_BY_CODE = {};
    D.customers.forEach((c) => { CUS_BY_CODE[c.customer_code] = c; });
    const PROD_BY_CODE = {};
    D.products.forEach((p) => { PROD_BY_CODE[p.product_code] = p; });

    /* ============================================================
     * ① 采购链：合同 → 订单 → 订单行 → 入库 → 进项发票 → 凭证 → 银行付款
     * ============================================================ */
    let poN = 0, prN = 0, invN = 0, vchN = 0, ctrN = 0;
    const purSuppliers = D.suppliers.filter((s) => s.supplier_code <= 'S050');

    /* 每家供应商 1 份年度框架合同 */
    purSuppliers.forEach((s) => {
      ctrN++;
      D.pur_contracts.push({
        id: nextIdFor('pur_contracts'), contract_no: `CON-2026-${pad(ctrN, 4)}`, supplier_code: s.supplier_code,
        contract_name: `${s.supplier_name}-年度采购框架协议`,
        total_amount: round2(R(3000000, 15000000)),
        sign_date: dstr(2026, RI(1, 3), RI(1, 27)) + 'T16:00:00.000Z',
        start_date: '2026-01-01T16:00:00.000Z', end_date: '2026-12-31T16:00:00.000Z',
        status: '执行中', created_at: '2026-01-05T00:00:00.000Z'
      });
    });
    const ctrOf = {};
    D.pur_contracts.forEach((c) => { ctrOf[c.supplier_code] = c.contract_no; });

    /* 采购订单生成：常规供应商每月 1~2 单；S028 每月 3 单 */
    function makePO(supplierCode, orderDate, maker, items) {
      poN++;
      const po = {
        id: nextIdFor('pur_orders'), po_no: `PO-2026${pad(new Date(orderDate).getMonth() + 1, 2)}-${pad(poN, 4)}`,
        supplier_code: supplierCode, contract_no: ctrOf[supplierCode] || '',
        order_date: orderDate, total_amount: 0, tax_amount: 0, grand_total: 0,
        status: '已入库', maker, created_at: orderDate.replace('T16:00:00.000Z', 'T09:00:00.000Z')
      };
      D.pur_orders.push(po);
      let amt = 0, tax = 0;
      items.forEach((it, idx) => {
        const p = PROD_BY_CODE[it.product_code];
        const qty = it.quantity;
        const price = it.unit_price != null ? it.unit_price : p.unit_price * R(0.92, 1.08);
        const lineAmt = round2(qty * price);
        const lineTax = round2(lineAmt * 0.13);
        amt = round2(amt + lineAmt); tax = round2(tax + lineTax);
        D.pur_order_items.push({
          id: nextIdFor('pur_order_items'), po_id: po.id, line_no: idx + 1, product_code: it.product_code,
          product_name: p.product_name, quantity: qty, unit: p.unit,
          unit_price: round2(price), tax_rate: 0.13, amount: lineAmt, tax_amount: lineTax,
          created_at: po.created_at
        });
      });
      po.total_amount = amt; po.tax_amount = tax; po.grand_total = round2(amt + tax);
      return po;
    }

    const normalPos = [];
    purSuppliers.forEach((s) => {
      if (s.supplier_code === 'S028') return;
      MONTHS.forEach((m) => {
        const cnt = (s.supplier_code >= 'S040') ? 1 : RI(1, 2);
        /* 常规采购单金额控制在 10 万 ~ 300 万元区间 */
        for (let k = 0; k < cnt; k++) {
          const d = RI(2, Math.min(26, daysInMonth(YEAR, m)));
          const maker = pick(['EMP031', 'EMP032', 'EMP033']);
          const mk = (s.supplier_code >= 'S043') ? 'EMP031' : maker;
          const prods = [pick(PROD_SEED)[0], pick(PROD_SEED)[0], pick(PROD_SEED)[0]];
          const uniq = Array.from(new Set(prods)).slice(0, RI(1, 3));
          const po = makePO(s.supplier_code, dstr(YEAR, m, d), mk,
            uniq.map((pc) => ({ product_code: pc, quantity: RI(2, 26) })));
          normalPos.push({ po, m, d });
        }
      });
    });

    /* —— 可疑供应商 S028：每月 3 单，单价显著高于基准价，制单人固定 EMP031 —— */
    const s028Pos = [];
    const s028PriceFactor = 2.6;
    MONTHS.forEach((m) => {
      for (let k = 0; k < 3; k++) {
        const d = RI(2, Math.min(25, daysInMonth(YEAR, m)));
        const po = makePO('S028', dstr(YEAR, m, d), 'EMP031', [
          { product_code: 'M001', quantity: RI(8, 32), unit_price: round2(PROD_BY_CODE.M001.unit_price * s028PriceFactor) },
          { product_code: 'M013', quantity: RI(3, 14), unit_price: round2(PROD_BY_CODE.M013.unit_price * s028PriceFactor) }
        ]);
        s028Pos.push({ po, m, d });
      }
    });

    /* ---- 入库单：常规订单 85% 入库；S028 的其中 2 张订单故意不入库（有票无货） ---- */
    const poHasReceipt = {};
    function makeReceipt(po, receiptDate, amount, status) {
      prN++;
      const r = {
        id: nextIdFor('pur_receipts'), receipt_no: `PR-2026-${pad(prN, 4)}`, po_id: po.id,
        receipt_date: receiptDate, total_amount: round2(amount), voucher_id: 0, status: status || '已入库',
        created_at: receiptDate.replace('T16:00:00.000Z', 'T10:00:00.000Z')
      };
      D.pur_receipts.push(r);
      poHasReceipt[po.id] = r;
      return r;
    }
    const allPos = D.pur_orders.slice();
    const noReceiptTargets = new Set();
    /* S028：每个季度第 1 单不入库 */
    s028Pos.filter((x, i) => i % 3 === 0 && x.m <= 9).forEach((x) => noReceiptTargets.add(x.po.id));
    /* 其他供应商：随机 6% 不入库 */
    normalPos.forEach((x) => { if (rnd() < 0.06) noReceiptTargets.add(x.po.id); });

    allPos.forEach((po) => {
      if (noReceiptTargets.has(po.id)) return;
      const od = new Date(po.order_date);
      const lag = RI(3, 20);
      const rd = clampYear(new Date(od.getTime() + lag * 86400000));
      const dateStr = `${rd.getFullYear()}-${pad(rd.getMonth() + 1, 2)}-${pad(rd.getDate(), 2)}T16:00:00.000Z`;
      makeReceipt(po, dateStr, po.total_amount, '已入库');
    });
    /* 单据日期倒挂样例：S028 的 7 月首单入库日期早于订单日期（订单≤入库≤发票链条断裂） */
    const revTarget = s028Pos.map((x) => x.po)
      .find((p) => poHasReceipt[p.id] && p.order_date.indexOf('-07-') > 0);
    if (revTarget) {
      const r = poHasReceipt[revTarget.id];
      const before = new Date(new Date(revTarget.order_date).getTime() - 11 * 86400000);
      r.receipt_date = `${before.getUTCFullYear()}-${pad(before.getUTCMonth() + 1, 2)}-${pad(before.getUTCDate(), 2)}T16:00:00.000Z`;
    } else {
      /* 兜底：任取一张有入库的 S028 订单 */
      const anyPo = D.pur_orders.find((p) => p.supplier_code === 'S028' && poHasReceipt[p.id]);
      if (anyPo) {
        const r = poHasReceipt[anyPo.id];
        const before = new Date(new Date(anyPo.order_date).getTime() - 11 * 86400000);
        r.receipt_date = `${before.getUTCFullYear()}-${pad(before.getUTCMonth() + 1, 2)}-${pad(before.getUTCDate(), 2)}T16:00:00.000Z`;
      }
    }

    /* ---- 进项发票：有入库单的 92% 有发票，S028 全部有发票（含无入库的订单） ---- */
    function makeInvoice(po, type, dateStr, amount, taxAmount, sourceRef, party) {
      invN++;
      return {
        id: nextIdFor('tax_invoice_pool'), invoice_no: `INV-${type === '进项' ? 'P' : 'S'}-2026-${pad(invN, 5)}`,
        invoice_type: type, invoice_date: dateStr, party_code: party.code, party_name: party.name,
        amount: round2(amount), tax_rate: 0.13, tax_amount: round2(taxAmount),
        total_amount: round2(amount + taxAmount), source_ref: sourceRef, voucher_id: 0,
        status: type === '进项' ? '已认证' : '正常', created_at: dateStr
      };
    }
    allPos.forEach((po) => {
      const r = poHasReceipt[po.id];
      const sup = SUP_BY_CODE[po.supplier_code];
      if (po.supplier_code === 'S028') {
        /* S028：无论是否入库都开票（整单） */
        const base = r ? r.receipt_date : po.order_date;
        const dd = clampYear(new Date(new Date(base).getTime() + RI(1, 8) * 86400000));
        const ds = `${dd.getFullYear()}-${pad(dd.getMonth() + 1, 2)}-${pad(dd.getDate(), 2)}T16:00:00.000Z`;
        const inv = makeInvoice(po, '进项', ds, po.total_amount, po.tax_amount,
          r ? r.receipt_no : po.po_no, { code: sup.supplier_code, name: sup.supplier_name });
        D.tax_invoice_pool.push(inv);
        return;
      }
      if (!r) return;
      if (rnd() < 0.92) {
        /* 金额不一致样例：3% 概率发票金额上调 5%~12% */
        let amt = po.total_amount, tax = po.tax_amount;
        if (rnd() < 0.03) { amt = round2(amt * R(1.05, 1.12)); tax = round2(amt * 0.13); }
        const dd = clampYear(new Date(new Date(r.receipt_date).getTime() + RI(1, 9) * 86400000));
        const ds = `${dd.getFullYear()}-${pad(dd.getMonth() + 1, 2)}-${pad(dd.getDate(), 2)}T16:00:00.000Z`;
        D.tax_invoice_pool.push(makeInvoice(po, '进项', ds, amt, tax, r.receipt_no,
          { code: sup.supplier_code, name: sup.supplier_name }));
      }
    });
    /* 进项发票无入库支撑样例：为 2 张无入库订单补开票（非 S028，制造孤立发票） */
    const orphanPO = D.pur_orders.filter((p) => !poHasReceipt[p.id] && p.supplier_code !== 'S028').slice(0, 3);
    orphanPO.forEach((po) => {
      const sup = SUP_BY_CODE[po.supplier_code];
      const dd = clampYear(new Date(new Date(po.order_date).getTime() + 5 * 86400000));
      D.tax_invoice_pool.push(makeInvoice(po, '进项',
        `${dd.getFullYear()}-${pad(dd.getMonth() + 1, 2)}-${pad(dd.getDate(), 2)}T16:00:00.000Z`,
        po.total_amount, po.tax_amount, po.po_no, { code: sup.supplier_code, name: sup.supplier_name }));
    });

    /* ---- 采购凭证（PUR）与付款银行流水 ---- */
    function makeVoucher(dateStr, type, summary, sourceSystem, sourceRef, debit, credit, maker, reviewer) {
      vchN++;
      const ym = dateStr.slice(0, 4) + dateStr.slice(5, 7);
      const v = {
        id: nextIdFor('gl_vouchers'), voucher_no: `VCH-${ym}-${pad(vchN, 4)}`, voucher_date: dateStr,
        voucher_type: type, summary, source_system: sourceSystem, source_ref: sourceRef,
        total_debit: round2(debit), total_credit: round2(credit != null ? credit : debit),
        maker, reviewer, status: '已审核', created_at: dateStr
      };
      D.gl_vouchers.push(v);
      return v;
    }
    function makeEntries(voucher, lines) {
      lines.forEach((ln, i) => {
        D.gl_voucher_entries.push({
          id: nextIdFor('gl_voucher_entries'), voucher_id: voucher.id, entry_line: i + 1, subject_code: ln.subject_code,
          summary: ln.summary, debit_amount: round2(ln.debit || 0), credit_amount: round2(ln.credit || 0),
          cost_center: ln.cost_center || '', project_code: ln.project_code || '', created_at: voucher.created_at
        });
      });
    }
    let bankN = 0;
    const paymentOfPO = {};
    function makePayment(po, dateStr, amount, counterparty, cptyAcct, summary, voucherId, matched) {
      bankN++;
      const ym = dateStr.slice(0, 4) + dateStr.slice(5, 7);
      const tx = {
        id: nextIdFor('bank_transactions'), bank_tx_id: `BTX-${ym}-${pad(bankN, 4)}`, account_no: MAIN_ACCT,
        tx_date: dateStr, tx_time: (`${pad(RI(9, 17), 2)}:${pad(RI(0, 59), 2)}`),
        tx_type: '支出', amount: round2(amount), counterparty, counterparty_account: cptyAcct,
        channel: '网银', summary, voucher_id: voucherId == null ? null : voucherId,
        matched: matched == null ? 1 : matched, created_at: dateStr
      };
      D.bank_transactions.push(tx);
      return tx;
    }

    const supAcct = (code) => '62' + pad(RI(100000000, 999999999), 9);
    D.pur_orders.forEach((po) => {
      const sup = SUP_BY_CODE[po.supplier_code];
      const r = poHasReceipt[po.id];
      const baseDate = r ? r.receipt_date : po.order_date;
      const payLag = RI(7, 40);
      const pd = clampYear(new Date(new Date(baseDate).getTime() + payLag * 86400000));
      const payDate = `${pd.getFullYear()}-${pad(pd.getMonth() + 1, 2)}-${pad(pd.getDate(), 2)}T16:00:00.000Z`;
      const v = makeVoucher(po.order_date, '记', `采购入库-${sup.supplier_name}-${PROD_BY_CODE[D.pur_order_items.find((x) => x.po_id === po.id).product_code].product_name}`,
        'PUR', po.po_no, po.grand_total, po.grand_total,
        po.maker, po.supplier_code === 'S028' ? 'EMP031' : 'EMP006');
      makeEntries(v, [
        { subject_code: '1403', summary: '原材料入库', debit: po.total_amount },
        { subject_code: '2221-02', summary: '进项税额13%', debit: po.tax_amount },
        { subject_code: '2202', summary: `应付${sup.supplier_name}`, credit: po.grand_total }
      ]);
      if (r) r.voucher_id = v.id;

      if (po.supplier_code === 'S028') {
        /*
         * —— 拆分付款植入 ——
         * 对每季度第 1 单，把本该一次支付的货款拆成 4~6 笔，
         * 单笔金额压在 4.1~4.9 万元（低于 5 万元审批线），集中落在同一周内。
         * 该形态对应 R05 规则（同一对手方 30 天内 ≥3 笔、单笔落在 4~5 万元区间）。
         */
        const sPos = s028Pos.find((x) => x.po.id === po.id);
        const isSplitPo = sPos && (s028Pos.indexOf(sPos) % 3) === 0;
        if (isSplitPo) {
          const total = po.grand_total;
          const parts = [];
          let left = total;
          /* 先拆出若干笔 4.1~4.9 万元的小额付款 */
          while (left > 50000 && parts.length < 8) {
            const a = round2(R(41000, 49000));
            parts.push(a);
            left = round2(left - a);
          }
          parts.push(left);
          const vp = makeVoucher(payDate, '付', `支付${sup.supplier_name}货款`, 'PUR', po.po_no, total, total, 'EMP031', 'EMP006');
          parts.forEach((part, i) => {
            /* 首笔即当日，其余顺延 0~2 天，形成短周期内多笔付款 */
            const dd = new Date(new Date(payDate).getTime() + (i === 0 ? 0 : RI(0, 2)) * 86400000);
            makePayment(po, clampYear(dd).toISOString(), part, sup.supplier_name, supAcct(sup.supplier_code),
              `银行付款-${sup.supplier_name}货款`, vp.id, 1);
          });
        } else {
          const vp = makeVoucher(payDate, '付', `支付${sup.supplier_name}货款`, 'PUR', po.po_no, po.grand_total, po.grand_total, 'EMP031', 'EMP006');
          makePayment(po, payDate, po.grand_total, sup.supplier_name, supAcct(sup.supplier_code),
            `银行付款-${sup.supplier_name}货款`, vp.id, 1);
        }
        paymentOfPO[po.id] = payDate;
        return;
      }

      /* 常规付款：85% 付款，其余挂账 */
      if (rnd() < 0.85) {
        const vp = makeVoucher(payDate, '付', `支付${sup.supplier_name}货款`, 'PUR', po.po_no, po.grand_total, po.grand_total, 'EMP013', 'EMP006');
        makePayment(po, payDate, po.grand_total, sup.supplier_name, supAcct(sup.supplier_code),
          `银行付款-${sup.supplier_name}货款`, vp.id, 1);
        paymentOfPO[po.id] = payDate;
      }
    });

    /* —— 资金回流植入：向 S028 付款后 21 天内，其法定代表人个人账户向本公司回流 —— */
    const S028_NAME = '安徽宏远机电设备有限公司';
    const s028Big = D.bank_transactions
      .filter((t) => t.counterparty === S028_NAME && t.tx_type === '支出')
      .sort((a, b) => b.amount - a.amount);
    /* 取金额最大的 3 笔（分处不同月份），确保回流记录落在同一会计年度 */
    const picked = [];
    const usedMonths = new Set();
    s028Big.forEach((t) => {
      const mm = t.tx_date.slice(5, 7);
      if (usedMonths.has(mm) || picked.length >= 3) return;
      const dd = new Date(new Date(t.tx_date).getTime() + 21 * 86400000);
      if (dd.getUTCFullYear() !== YEAR) return;
      usedMonths.add(mm);
      picked.push(t);
    });
    picked.forEach((tx) => {
      const dd = new Date(new Date(tx.tx_date).getTime() + 21 * 86400000);
      bankN++;
      const ymStr = `${dd.getUTCFullYear()}${pad(dd.getUTCMonth() + 1, 2)}`;
      D.bank_transactions.push({
        id: nextIdFor('bank_transactions'), bank_tx_id: `BTX-${ymStr}-${pad(bankN, 4)}`, account_no: MAIN_ACCT,
        tx_date: `${dd.getUTCFullYear()}-${pad(dd.getUTCMonth() + 1, 2)}-${pad(dd.getUTCDate(), 2)}T16:00:00.000Z`,
        tx_time: '21:47', tx_type: '收入', amount: round2(tx.amount * R(0.82, 0.95)),
        counterparty: '沈立国', counterparty_account: '6228480012345678',
        channel: '个人网银', summary: '个人转入-往来款',
        voucher_id: null, matched: 1, created_at: tx.tx_date
      });
    });

    /* —— 大额个人卡/现金付款植入（异常渠道） —— */
    const abnormalChannel = [
      { m: 3, d: 18, amt: 386000, cp: '个人-王某某', acct: '6212260098765432', ch: '个人网银', sum: '支付个人-往来款' },
      { m: 7, d: 9, amt: 268000, cp: '个人-李某某', acct: '6222020011223344', ch: '现金', sum: '现金支取-备用金' },
      { m: 11, d: 22, amt: 512000, cp: '个人-张某某', acct: '6228480055667788', ch: '个人网银', sum: '支付个人-劳务费' }
    ];
    abnormalChannel.forEach((x) => {
      const ds = dstr(YEAR, x.m, x.d) + 'T16:00:00.000Z';
      const vp = makeVoucher(ds, '付', `支付${x.cp}`, 'AIS', '', x.amt, x.amt, 'EMP008', 'EMP006');
      makePayment(null, ds, x.amt, x.cp, x.acct, x.sum, vp.id, 1);
    });

    /* —— 银行流水无账面凭证（voucher_id 为空） —— */
    [ { m: 2, d: 14, amt: 1246000, cp: '安徽宏远机电设备有限公司' },
      { m: 8, d: 27, amt: 883000, cp: '深圳市前海万通贸易有限公司' },
      { m: 10, d: 6, amt: 2100000, cp: '上海泰和商务咨询有限公司' }
    ].forEach((x) => {
      const ds = dstr(YEAR, x.m, x.d) + 'T16:00:00.000Z';
      const sup = D.suppliers.find((s) => s.supplier_name === x.cp);
      makePayment(null, ds, x.amt, x.cp, supAcct(sup ? sup.supplier_code : 'S001'), `银行付款-${x.cp}往来款`, null, 1);
    });

    /* —— 账面无银行流水支撑（matched=0 未达账项） —— */
    [ { m: 5, d: 30, amt: 3180000, cp: '太钢不锈销售有限公司' },
      { m: 12, d: 30, amt: 4760000, cp: '万华化学供应公司' }
    ].forEach((x) => {
      const ds = dstr(YEAR, x.m, x.d) + 'T16:00:00.000Z';
      const sup = D.suppliers.find((s) => s.supplier_name === x.cp);
      const vp = makeVoucher(ds, '付', `支付${x.cp}货款`, 'PUR', '', x.amt, x.amt, 'EMP013', 'EMP006');
      makePayment(null, ds, x.amt, x.cp, supAcct(sup.supplier_code), `银行付款-${x.cp}货款`, vp.id, 0);
    });

    /* ============================================================
     * ② 销售链：订单 → 订单行 → 发货 → 销项发票 → 收入凭证 → 收款流水
     * ============================================================ */
    let soN = 0, dlN = 0;
    MONTHS.forEach((m) => {
      const cnt = RI(34, 40);
      for (let k = 0; k < cnt; k++) {
        soN++;
        const d = RI(1, daysInMonth(YEAR, m));
        const ds = dstr(YEAR, m, d) + 'T16:00:00.000Z';
        const cus = pick(D.customers);
        const emp = pick(['EMP016', 'EMP017', 'EMP018']);
        const so = {
          id: nextIdFor('sal_orders'), so_no: `SO-${YEAR}${pad(m, 2)}-${pad(soN, 4)}`, customer_code: cus.customer_code,
          order_date: ds, total_amount: 0, tax_amount: 0, grand_total: 0, status: '已完成',
          sales_emp: emp, created_at: ds
        };
        D.sal_orders.push(so);
        const prods = Array.from(new Set([pick(PROD_SEED)[0], pick(PROD_SEED)[0]]));
        let amt = 0, tax = 0;
        prods.forEach((pc, idx) => {
          const p = PROD_BY_CODE[pc];
          const qty = RI(2, 60);
          const price = round2(p.unit_price * R(1.18, 1.45));
          const lineAmt = round2(qty * price);
          const lineTax = round2(lineAmt * 0.13);
          amt = round2(amt + lineAmt); tax = round2(tax + lineTax);
          D.sal_order_items.push({
            id: nextIdFor('sal_order_items'), so_id: so.id, line_no: idx + 1, product_code: pc, product_name: p.product_name,
            quantity: qty, unit: p.unit, unit_price: price, tax_rate: 0.13, amount: lineAmt,
            tax_amount: lineTax, created_at: ds
          });
        });
        so.total_amount = amt; so.tax_amount = tax; so.grand_total = round2(amt + tax);

        /* 发货 */
        dlN++;
        const ddd = clampYear(new Date(new Date(ds).getTime() + RI(2, 12) * 86400000));
        const dls = `${ddd.getFullYear()}-${pad(ddd.getMonth() + 1, 2)}-${pad(ddd.getDate(), 2)}T16:00:00.000Z`;
        const dl = {
          id: nextIdFor('sal_deliveries'), delivery_no: `DL-${YEAR}-${pad(dlN, 5)}`, so_id: so.id, delivery_date: dls,
          total_amount: so.total_amount, voucher_id: 0, status: '已发货', created_at: dls
        };
        D.sal_deliveries.push(dl);

        /* 收入凭证 + 销项发票 */
        vchN++;
        const v = {
          id: nextIdFor('gl_vouchers'), voucher_no: `VCH-${YEAR}${pad(m, 2)}-${pad(vchN, 4)}`, voucher_date: dls,
          voucher_type: '记', summary: `确认销售收入-${cus.customer_name}`,
          source_system: 'SAL', source_ref: so.so_no,
          total_debit: so.grand_total, total_credit: so.grand_total,
          maker: pick(['EMP012', 'EMP014', 'EMP011']), reviewer: 'EMP006', status: '已审核', created_at: dls
        };
        D.gl_vouchers.push(v);
        makeEntries(v, [
          { subject_code: '1122', summary: `应收${cus.customer_name}货款`, debit: so.grand_total },
          { subject_code: '6001', summary: '主营业务收入-装备制造', credit: so.total_amount },
          { subject_code: '2221-01', summary: '销项税额13%', credit: so.tax_amount }
        ]);
        /* 同步结转主营业务成本（成本率约 62%），使毛利率等指标可计算 */
        vchN++;
        const costAmt = round2(so.total_amount * 0.62);
        const vc = {
          id: nextIdFor('gl_vouchers'), voucher_no: `VCH-${YEAR}${pad(m, 2)}-${pad(vchN, 4)}`, voucher_date: dls,
          voucher_type: '转', summary: `结转销售成本-${cus.customer_name}`,
          source_system: 'AIS', source_ref: so.so_no,
          total_debit: costAmt, total_credit: costAmt,
          maker: 'EMP012', reviewer: 'EMP006', status: '已审核', created_at: dls
        };
        D.gl_vouchers.push(vc);
        makeEntries(vc, [
          { subject_code: '6401', summary: '主营业务成本-装备制造', debit: costAmt },
          { subject_code: '1405', summary: '库存商品结转', credit: costAmt }
        ]);
        dl.voucher_id = v.id;
        invN++;
        const ds2 = `${ddd.getFullYear()}-${pad(ddd.getMonth() + 1, 2)}-${pad(ddd.getDate(), 2)}T16:00:00.000Z`;
        D.tax_invoice_pool.push({
          id: nextIdFor('tax_invoice_pool'), invoice_no: `INV-S-${YEAR}-${pad(invN, 5)}`, invoice_type: '销项',
          invoice_date: ds2, party_code: cus.customer_code, party_name: cus.customer_name,
          amount: so.total_amount, tax_rate: 0.13, tax_amount: so.tax_amount,
          total_amount: so.grand_total, source_ref: so.so_no, voucher_id: v.id,
          status: '正常', created_at: ds2
        });

        /* 收款：82% 回款 */
        if (rnd() < 0.82) {
          const rd = clampYear(new Date(new Date(dls).getTime() + RI(10, 60) * 86400000));
          if (rd.getFullYear() === 2026) {
            const rs = `${rd.getFullYear()}-${pad(rd.getMonth() + 1, 2)}-${pad(rd.getDate(), 2)}T16:00:00.000Z`;
            bankN++;
            const ym = `${rd.getFullYear()}${pad(rd.getMonth() + 1, 2)}`;
            D.bank_transactions.push({
              id: nextIdFor('bank_transactions'), bank_tx_id: `BTX-${ym}-${pad(bankN, 4)}`, account_no: MAIN_ACCT,
              tx_date: rs, tx_time: `${pad(RI(9, 17), 2)}:${pad(RI(0, 59), 2)}`,
              tx_type: '收入', amount: so.grand_total,
              counterparty: cus.customer_name, counterparty_account: '66' + pad(RI(100000000, 999999999), 9),
              channel: '网银', summary: `银行收款-${cus.customer_name}货款`,
              voucher_id: v.id, matched: 1, created_at: rs
            });
          }
        }
      }
    });

    /* ============================================================
     * ③ OA 报销链：报销单 → 审批记录 → 凭证
     * ============================================================ */
    let oaN = 0, apN = 0;
    const oaEmps = D.employees.filter((e) => ['D011', 'D012', 'D014', 'D015', 'D019', 'D020', 'D028', 'D004', 'D006'].indexOf(e.dept_code) >= 0);
    MONTHS.forEach((m) => {
      const cnt = RI(28, 34);
      for (let k = 0; k < cnt; k++) {
        oaN++;
        const dept = ['差旅', '办公', '招待', '交通'];
        const type = pick(dept);
        const isSuspicious = rnd() < 0.08;
        const emp = isSuspicious ? D.employees.find((e) => e.emp_code === 'EMP031') : pick(oaEmps);
        const maxDay = daysInMonth(YEAR, m);
        const day = isSuspicious || rnd() < 0.3 ? RI(Math.max(1, maxDay - 2), maxDay) : RI(1, maxDay - 3);
        const ds = dstr(YEAR, m, day) + 'T16:00:00.000Z';
        let amount = round2(R(2000, 60000));
        if (type === '招待') amount = round2(R(8000, 88000));
        if (isSuspicious) amount = round2(R(60000, 98000));
        const rep = {
          id: nextIdFor('oa_expense_reports'), report_no: `EXP-${YEAR}${pad(m, 2)}-${pad(oaN, 4)}`, emp_code: emp.emp_code,
          dept_code: emp.dept_code, expense_type: type, amount,
          submit_date: ds, status: '已审批', voucher_id: 0,
          description: `${type}费报销-天津-${pick(['上海', '北京', '广州', '深圳', '成都', '南京'])}-${emp.position}出差`,
          created_at: ds
        };
        D.oa_expense_reports.push(rep);

        /* 凭证：可疑报销的凭证金额与报销金额不符 */
        vchN++;
        const vAmt = isSuspicious ? round2(amount * R(0.45, 0.7)) : amount;
        const v = {
          id: nextIdFor('gl_vouchers'), voucher_no: `VCH-${YEAR}${pad(m, 2)}-${pad(vchN, 4)}`, voucher_date: ds,
          voucher_type: '记', summary: `${type}费报销-${emp.emp_name}`, source_system: 'OA',
          source_ref: rep.report_no, total_debit: vAmt, total_credit: vAmt,
          maker: 'EMP007', reviewer: 'EMP006', status: '已审核', created_at: ds
        };
        D.gl_vouchers.push(v);
        rep.voucher_id = v.id;
        makeEntries(v, [
          { subject_code: type === '办公' ? '6602-01' : type === '招待' ? '6601-02' : type === '差旅' ? '6601-01' : '6602-02',
            summary: `${type}费`, debit: vAmt, cost_center: 'CC-MGT-01' },
          { subject_code: '1002-01', summary: '银行付款', credit: vAmt }
        ]);

        /* 审批记录：常规 2 级；可疑仅 1 级（补签） */
        apN++;
        D.oa_approval_records.push({
          id: nextIdFor('oa_approval_records'), report_id: rep.id, approver_code: 'EMP038', approver_name: '贾立新',
          step: 1, action: '同意', comment: '同意', action_time: ds, created_at: ds
        });
        if (!isSuspicious) {
          apN++;
          D.oa_approval_records.push({
            id: nextIdFor('oa_approval_records'), report_id: rep.id, approver_code: 'EMP005', approver_name: '梁秀兰',
            step: 2, action: '同意', comment: '审核通过', action_time: ds, created_at: ds
          });
        }

        /* 报销付款流水 */
        const rd = clampYear(new Date(new Date(ds).getTime() + RI(3, 8) * 86400000));
        if (rd.getFullYear() === 2026) {
          const rs = `${rd.getFullYear()}-${pad(rd.getMonth() + 1, 2)}-${pad(rd.getDate(), 2)}T16:00:00.000Z`;
          bankN++;
          const ym = `${rd.getFullYear()}${pad(rd.getMonth() + 1, 2)}`;
          D.bank_transactions.push({
            id: nextIdFor('bank_transactions'), bank_tx_id: `BTX-${ym}-${pad(bankN, 4)}`, account_no: MAIN_ACCT,
            tx_date: rs, tx_time: `${pad(RI(9, 17), 2)}:${pad(RI(0, 59), 2)}`,
            tx_type: '支出', amount, counterparty: emp.emp_name,
            counterparty_account: emp.bank_account, channel: '网银',
            summary: `报销付款-${emp.emp_name}-${type}费`, voucher_id: v.id, matched: 1, created_at: rs
          });
        }
      }
    });

    /* ============================================================
     * ④ 研发工时 / 税务申报 / 总账明细
     * ============================================================ */
    const rdEmps = ['EMP027', 'EMP028', 'EMP026', 'EMP031'];
    rdEmps.forEach((ec) => {
      MONTHS.forEach((m) => {
        const prj = pick(PRJ_SEED)[0];
        const hours = rnd() < 0.25 ? round2(R(26, 38)) : round2(R(6, 16));
        const rate = round2(R(300, 480));
        const d = RI(1, daysInMonth(YEAR, m));
        D.rd_timesheets.push({
          id: nextIdFor('rd_timesheets'), emp_code: ec, project_code: prj, cost_center: pick(['CC-RD-01', 'CC-RD-02']),
          work_date: dstr(YEAR, m, d) + 'T16:00:00.000Z', hours, hourly_rate: rate,
          labor_cost: round2(hours * rate), description: pick(['算法研发与测试', '代码审查与优化', '系统集成联调', '样机试制']),
          created_at: dstr(YEAR, m, d) + 'T16:00:00.000Z'
        });
      });
    });

    MONTHS.forEach((m) => {
      const ym = `${YEAR}${pad(m, 2)}`;
      const sos = D.sal_orders.filter((s) => s.order_date.slice(0, 7) === `${YEAR}-${pad(m, 2)}`);
      const outputAmount = round2(sos.reduce((a, s) => a + s.total_amount, 0));
      const outputTax = round2(sos.reduce((a, s) => a + s.tax_amount, 0));
      const pos = D.pur_orders.filter((p) => p.order_date.slice(0, 7) === `${YEAR}-${pad(m, 2)}`);
      const inputAmount = round2(pos.reduce((a, p) => a + p.total_amount, 0));
      const inputTax = round2(pos.reduce((a, p) => a + p.tax_amount, 0));
      D.tax_vat_declarations.push({
        id: nextIdFor('tax_vat_declarations'), declaration_period: ym, output_amount: outputAmount, output_tax: outputTax,
        input_amount: inputAmount, input_tax: inputTax,
        payable_tax: round2(outputTax - inputTax), actual_paid: round2(outputTax - inputTax),
        status: '已申报', voucher_id: null, created_at: `${ym.slice(0, 4)}-${ym.slice(4)}-15T00:00:00.000Z`
      });
    });

    /* 总账明细：由凭证分录派生（保持期初期末口径一致） */
    let ledgerId = 1;
    const byPeriodSubject = new Map();
    D.gl_voucher_entries.forEach((e) => {
      const v = D.gl_vouchers.find((x) => x.id === e.voucher_id);
      if (!v) return;
      const period = v.voucher_date.slice(0, 7).replace('-', '');
      const key = period + '|' + e.subject_code;
      if (!byPeriodSubject.has(key)) {
        byPeriodSubject.set(key, { period, subject_code: e.subject_code, entry_date: v.voucher_date,
          voucher_id: v.id, summary: e.summary, debit_amount: 0, credit_amount: 0 });
      }
      const rec = byPeriodSubject.get(key);
      rec.debit_amount = round2(rec.debit_amount + Number(e.debit_amount));
      rec.credit_amount = round2(rec.credit_amount + Number(e.credit_amount));
    });
    const balanceMap = new Map();
    Array.from(byPeriodSubject.values())
      .sort((a, b) => (a.period === b.period ? a.subject_code.localeCompare(b.subject_code) : a.period.localeCompare(b.period)))
      .forEach((rec) => {
        const bal = round2((balanceMap.get(rec.subject_code) || 0) + rec.debit_amount - rec.credit_amount);
        balanceMap.set(rec.subject_code, bal);
        D.gl_ledger.push({
          id: ledgerId++, subject_code: rec.subject_code, period: rec.period, entry_date: rec.entry_date,
          voucher_id: rec.voucher_id, summary: rec.summary,
          debit_amount: rec.debit_amount, credit_amount: rec.credit_amount, balance: bal,
          created_at: rec.entry_date
        });
      });

    /* 主键按表独立编号，外键已在构建时直接引用目标 id，无需重排 */
    return D;
  }

  return { build, YEAR };
});
