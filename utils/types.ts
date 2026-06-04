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
  skills: string[];
  excludeKeywords?: string[];
}
