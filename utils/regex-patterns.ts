// Pre-compiled regex patterns (compiled once, reused many times)
export const REGEX_PATTERNS = {
  // Seniority
  senior: /\bsenior\b|\bsr\.?\b|\blead\b|\bstaff\b|\bprincipal\b/i,
  mid: /\bmid\b|\bssr\b|\bsemi\b/i,
  junior: /\bjunior\b|\bjr\.?\b|\bentry\b|\btrainee\b/i,

  // Modalidad
  remote: /remot[eo]/i,
  hybrid: /h[íi]brid/i,

  // Manual QA + STLC
  manual: /\bmanual\b/i,
  stlc: /\bstlc\b|software testing life cycle/i,
  testPlan: /test\s+(plan|case|suite|strateg)|traceabilit|casos de prueba|plan de pruebas|matriz de trazabilidad/i,

  // API testing
  postman: /\bpostman\b/i,
  insomnia: /\binsomnia\b|\bcharles\s*proxy\b/i,
  restApi: /\brest\s*api\b|\bapi\s+test|api\s+validat/i,

  // Base de datos
  sql: /\bsql\b/i,
  databaseTest: /database\s+test|data\s+integrit|consultas\s+sql/i,

  // Arquitectura moderna
  microservice: /microservice/i,
  eventDriven: /event.driven|\beda\b/i,

  // Bug tracking
  jira: /\bjira\b/i,
  azureDevops: /azure\s+devops/i,

  // Herramientas de automatización
  playwright: /playwright/i,
  cypress: /\bcypress\b/i,
  selenium: /\bselenium\b/i,
  appium: /\bappium\b/i,
  sdet: /\bsdet\b/i,

  // CI/CD
  cicd: /ci\/cd|github\s+actions|gitlab\s+ci|\bjenkins\b/i,
  containerization: /\bdocker\b|\bkubernetes\b/i,

  // Performance
  loadTesting: /\bk6\b|\bjmeter\b|\bgatling\b/i,

  // Metodología ágil
  agile: /\bagile\b|\bscrum\b/i,

  // Accesibilidad / seguridad
  accessibility: /\bwcag\b|accessibility\s+test|pruebas\s+de\s+accesibilidad/i,
  security: /security\s+test|pruebas\s+de\s+seguridad/i,

  // AI tools
  aiTools: /cursor\b|windsurf|claude\s+code|copilot\s+cli|gemini\s+cli|\bcodex\b/i,
  ai: /\bai\b|artificial intelligence|\bllm\b|machine learning|inteligencia artificial/i,

  // Cliente US / nearshore
  english: /\benglish\b|\bingl[eé]s\b/i,
  usClient: /us\s+client|cliente\s+(us|eeuu)|gorilla\s+logic|toptal|perficient/i,

  // LATAM / Colombia
  latam: /\blatam\b|latin\s+america/i,
  nearshore: /nearshore/i,
  timezone: /timezone.{0,30}(est|pst|cst|et\b|pt\b|ct\b)|compatible.{0,20}timezone|work\s+from\s+anywhere|anywhere\s+in\s+the\s+world/i,
  internationalTeam: /open\s+to\s+international|global\s+(remote\s+)?team|international\s+team|distributed\s+team/i,
  estTimezone: /\best\s*(?:time\s*)?zone|eastern\s+time|office\s+hours.*est/i,

  // US-only restrictions
  usAuthRequired: /must\s+be\s+authorized\s+to\s+work|authorized\s+to\s+work\s+in\s+the\s+u\.?s|u\.?s\.?\s+citizen(ship)?|green\s+card|must\s+reside\s+in\s+the\s+u\.?s|only\s+u\.?s\.?\s+residents?/i,
  contractor: /\bc2c\b|\bw-?2\b|\b1099\b/i,

  // Señales negativas
  manufacturing: /manufactur|industrial|hardware|mec[áa]nic|embedded|firmware/i,
  sap: /\bsap\b/i,
  edtech: /edtech|game\s+test|videogame/i,

  // ─ Salary parsing patterns ─
  usdKTo: /\$\s*(\d+(?:\.\d+)?)\s*[kK]\s+to\s+\$?\s*(\d+(?:\.\d+)?)\s*[kK]/i,
  usdKRange: /\$\s*(\d+(?:\.\d+)?)\s*[kK]\s*[-–—]\s*\$?\s*(\d+(?:\.\d+)?)\s*[kK]/,
  usdRange: /\$\s*([\d,]+)\s*[-–—]\s*\$?\s*([\d,]+)/,
  usdSingleK: /\$\s*(\d+(?:\.\d+)?)\s*[kK]/,
  usdSingle: /\$\s*([\d,]+)/,
  copRange: /(?:cop|pesos?)\s*([\d.,]+)\s*[-–—]\s*([\d.,]+)/i,

  // ─ Hybrid/on-site patterns ─
  onSiteRequired: /\bon[\s-]?site\s+required|\bmust\s+be\s+on[\s-]?site|\bpresencial\b|\bin[\s-]?office\s+required/i,
  daysInOffice: /\b[2-5]\s*[-–]?\s*[2-5]?\s*days?\s*(a\s*week|per\s*week|\/week|in[\s-]?(the\s*)?office|on[\s-]?site)\b/i,
  daysPerWeek: /\b[2-5]\s*x\s*(a\s*week|per\s*week|\/week)\s*(in[\s-]?(the\s*)?office|on[\s-]?site)/i,
  flexibleHybrid: /flexible\s+hybrid|hybrid\s+(work|model|role|schedule|position|arrangement)/i,

  // ─ Exclusion patterns ─
  usPresenceRequired: /must\s+be\s+authorized\s+to\s+work|authorized\s+to\s+work\s+in\s+the\s+u\.?s|u\.?s\.?\s+citizen(ship)?\s+required|green\s+card\s+required|must\s+reside\s+in\s+the\s+u\.?s|only\s+u\.?s\.?\s+residents?|legally\s+authorized\s+to\s+work\s+in\s+the\s+(u\.?s\.?|united\s+states)|must\s+be\s+(based|located)\s+in\s+the\s+(u\.?s\.?|united\s+states)|u\.?s\.?[\s-]based\s+candidates?\s+only|no\s+(visa\s+)?sponsorship\s+(available|provided|offered)|sponsorship\s+(is\s+)?not\s+(available|provided|offered)/i,
  estOnlyTimezone: /\best\s*(?:time\s*)?zone|eastern\s+time|new\s+york\s+time|hours\s+est|office\s+hours.*est/i,
  mexicoOnly: /solo\s+(para\s+)?(residentes?\s+(en\s+)?)?m[eé]xico|exclusivo\s+m[eé]xico|only\s+(for\s+)?mexico/i,
  argentinaOnly: /solo\s+(para\s+)?(residentes?\s+(en\s+)?)?argentina|exclusivo\s+argentina/i,
  chileOnly: /solo\s+(para\s+)?(residentes?\s+(en\s+)?)?chile|exclusivo\s+chile/i,
  peruOnly: /solo\s+(para\s+)?(residentes?\s+(en\s+)?)?per[uú]|exclusivo\s+per[uú]/i,
} as const;
