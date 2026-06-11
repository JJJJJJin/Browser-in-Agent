export type JobSummary = {
  oneLineSummary: string;
  responsibilities: string[];
  mustHaveRequirements: string[];
  niceToHaveRequirements: string[];
  techStack: string[];
  domain: string;
  seniority: string;
};

export type StrengthMatch = {
  requirement: string;
  evidence: string;
};

export type GapMatch = {
  requirement: string;
  suggestion: string;
};

export type MatchAnalysis = {
  fitScore: number;
  oneLineFit: string;
  strengths: StrengthMatch[];
  gaps: GapMatch[];
  transferableSkills: string[];
  keywordsToEmphasize: string[];
};

export type CompanyBrief = {
  companyOneLiner: string;
  whatTheyDo: string;
  productsOrServices: string[];
  industryAndMarket: string;
  cultureAndValues: string;
  positionContext: string;
  thingsToVerify: string[];
};

export type InterviewQuestionCategory =
  | 'motivation'
  | 'experience'
  | 'behavioral'
  | 'technical'
  | 'company-fit'
  | 'closing';

export type InterviewQA = {
  question: string;
  category: InterviewQuestionCategory;
  suggestedAnswer: string;
  evidenceFromProfile: string[];
  notes: string | null;
};

export type InterviewPack = {
  questions: InterviewQA[];
  questionsToAskThem: string[];
};

export type JobApplication = {
  jobId: string;
  jobUrl: string;
  jobTitle: string;
  company: string | null;
  jobSummary: JobSummary;
  matchAnalysis: MatchAnalysis;
  resumeMarkdown: string;
  coverLetter: string;
  companyBrief: CompanyBrief;
  interviewPack: InterviewPack;
  model: string;
  generatedAt: string;
  profileHash: string;
};
