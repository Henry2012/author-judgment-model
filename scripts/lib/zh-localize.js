const DOMAIN_LABELS = {
  real_estate: "房产 / 城市 / 资产配置",
  stock_market: "股市 / 投资 / 估值",
  employment: "就业 / 教育 / 收入",
  manufacturing: "汽车 / 制造业 / 价格竞争",
  macro_policy: "宏观 / 政策 / 人口 / 财政",
  public_services: "公共服务 / 医疗 / 教育财政",
  general: "通用问题"
};

const VARIABLE_LABELS = {
  liquidity: "流动性",
  rent_to_price_ratio: "租售比",
  city_opportunity: "城市机会",
  household_balance_sheet: "家庭资产负债",
  exit_cost: "退出成本",
  valuation: "估值",
  capital_flow: "资金流向",
  policy_direction: "政策方向",
  profit_realization: "盈利兑现",
  job_quality: "岗位质量",
  family_resources: "家庭资源",
  industry_supply_demand: "行业供需",
  work_intensity: "工作强度",
  pricing_freedom: "定价自由",
  demand_capacity: "需求容量",
  margin: "利润率",
  supply_chain_efficiency: "供应链效率",
  export_capacity: "出海能力",
  policy_objective: "政策目标",
  population_structure: "人口结构",
  fiscal_constraint: "财政约束",
  market_mechanism: "市场机制",
  incentive_alignment: "激励相容",
  payer: "谁付钱",
  price_control: "价格管制",
  fiscal_coverage: "财政覆盖",
  labor_intensity: "劳动强度",
  market_regime: "市场状态",
  mainline_clarity: "主线清晰度",
  index_strength: "指数强弱",
  sector_leadership: "板块领涨性",
  risk_reward: "盈亏比",
  trend_direction: "趋势方向",
  pullback_quality: "回踩质量",
  acceleration_phase: "加速阶段",
  entry_timing: "入场时机",
  chase_risk: "追涨风险",
  stop_loss: "止损纪律",
  position_size: "仓位大小",
  core_position: "底仓纪律",
  loss_control: "亏损控制",
  holding_period: "持仓周期",
  industry_demand: "产业需求",
  global_cycle: "全球周期",
  supply_constraint: "供给约束",
  earnings_growth: "业绩增长",
  technology_mainline: "科技主线",
  emotional_state: "情绪状态",
  execution_discipline: "执行纪律",
  cognitive_openness: "认知开放度",
  patience: "耐心",
  greed_fear_balance: "贪婪恐惧平衡",
  intraday_strength: "盘中强弱",
  volume_confirmation: "成交量确认",
  index_feedback: "指数反馈",
  market_breadth: "市场广度",
  short_term_signal: "短线信号",
  fermentation_time: "发酵时间",
  oven_temperature: "烤箱温度",
  strength_growth: "力量增长",
  sleep_recovery: "睡眠恢复",
  diet_execution: "饮食执行",
  weight_volatility: "体重波动",
  temperature: "温度",
  ingredient_ratio: "配料比例"
};

const CHINESE_NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

const ACTION_TENDENCY_LABELS = {
  apply_model_with_boundaries: "套用证据支持的判断模型，并说明边界和置信度",
  refuse_or_downgrade_confidence: "拒答或降低置信度",
  wait_for_evidence: "等待更多证据",
  compare_models: "比较多个判断模型"
};

function hasChinese(value) {
  return /[\u3400-\u9fff]/u.test(String(value || ""));
}

function genericVariableLabel(index) {
  return `变量${CHINESE_NUMERALS[index] || index + 1}`;
}

function labelVariable(variable, index = 0) {
  const value = String(variable || "").trim();
  if (!value) return genericVariableLabel(index);
  if (VARIABLE_LABELS[value]) return VARIABLE_LABELS[value];
  if (hasChinese(value) && !/[A-Za-z_]/u.test(value)) return value;
  return genericVariableLabel(index);
}

function labelVariables(variables = []) {
  return variables.map((variable, index) => labelVariable(variable, index));
}

function labelDomain(domainId, config = {}) {
  if (DOMAIN_LABELS[domainId]) return DOMAIN_LABELS[domainId];
  const domain = config.domains?.[domainId];
  if (domain?.name && hasChinese(domain.name)) return domain.name;
  return domainId === "general" ? DOMAIN_LABELS.general : "作者自定义判断域";
}

function labelActionTendency(action) {
  const value = String(action || "").trim();
  if (!value) return ACTION_TENDENCY_LABELS.apply_model_with_boundaries;
  if (ACTION_TENDENCY_LABELS[value]) return ACTION_TENDENCY_LABELS[value];
  if (hasChinese(value)) return value;
  return ACTION_TENDENCY_LABELS.apply_model_with_boundaries;
}

function labelConfidence(confidence) {
  if (confidence === "high") return "高";
  if (confidence === "medium") return "中";
  if (confidence === "low") return "低";
  return "未知";
}

function localizeBoundary(boundary) {
  const value = String(boundary || "").trim();
  if (!value) return "";
  if (hasChinese(value) && !/[A-Za-z]{3,}/u.test(value)) return value;
  if (/corpus-backed judgment approximation/i.test(value)) {
    return "这是基于历史语料的判断近似，不能视为作者未来观点。";
  }
  if (/real-time factual claims/i.test(value)) {
    return "涉及实时事实时，需要先做外部核验，再应用这个判断模型。";
  }
  if (/supplied weibo corpus/i.test(value) || /derived from the supplied/i.test(value)) {
    return "该模型只来自已提供的微博语料。";
  }
  if (/must not imitate/i.test(value) || /do not imitate/i.test(value)) {
    return "不得模仿作者语气、人设、口头禅或表达习惯。";
  }
  if (/unsupported topics/i.test(value) || /refused or downgraded/i.test(value)) {
    return "语料不支持的主题应拒答或降低置信度。";
  }
  if (/personal view|personal statement|represent the author/i.test(value)) {
    return "回答不代表作者本人授权或个人表态。";
  }
  return "仅基于历史语料生成判断近似，不能外推为作者本人观点。";
}

function localizeBoundaries(boundaries = []) {
  return Array.from(new Set(boundaries.map(localizeBoundary).filter(Boolean)));
}

function localizedModelSummary({ domain, variables, config }) {
  const labels = labelVariables(variables);
  const variableText = labels.length ? labels.join("、") : "语料支持的核心变量";
  return `该判断模型属于「${labelDomain(domain, config)}」判断域，会优先检查${variableText}，再结合证据链判断问题是否落在作者稳定表达过的范围内。`;
}

module.exports = {
  labelActionTendency,
  labelDomain,
  labelConfidence,
  labelVariable,
  labelVariables,
  localizeBoundary,
  localizeBoundaries,
  localizedModelSummary
};
