export interface JobSalary {
  min?: number;
  max?: number;
  currency: string;
  raw: string;
}

export interface Job {
  title: string;
  company: string;
  location: string;
  link: string;
  datePosted?: string;
  description?: string;
  sourceLocation?: string;
  savedAt?: string;
  score?: number;
  detectedCountry?: string;
  notifiedAt?: string;
  salary?: JobSalary;
}

export interface AppliedJob {
  title: string;
  company: string;
  location: string;
  link: string;
  appliedDate: string;
  status: string;
}

export interface CvProfile {
  name?: string;
  title?: string;
  location?: string;
  languages?: string;
  yearsOfExperience?: number;
  summary?: string;
  skills: string[];
  excludeKeywords?: string[];
  blockedCompanies?: string[];
}
