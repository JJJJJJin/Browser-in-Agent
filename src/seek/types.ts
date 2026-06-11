export type SeekSalary = {
  raw?: string | null;
  currency?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  unitText?: string | null;
};

export type SeekJob = {
  jobId: string;
  url: string;
  title: string;
  company: string | null;
  location: string | null;
  workType: string | null;
  classification: string | null;
  subClassification: string | null;
  salary: SeekSalary | null;
  postedAt: string | null;
  validThrough: string | null;
  shortDescription: string | null;
  description: string;
  descriptionHtml: string | null;
  bulletPoints: string[];
  source: 'json-ld' | 'next-data' | 'llm' | 'mixed';
  rawJsonLd: unknown | null;
  fetchedAt: string;
};
