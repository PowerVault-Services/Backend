export type EvidenceImage = { label?: string; filePath: string };
export type EvidenceGroup = {
  title: string;
  images: EvidenceImage[];
};
export type CertificateItem = {
  description: string;
  location: string;
  signaturePV?: string | null;
  signatureCustomer?: string | null;
};
export type CertificateApproval = 'approval' | 'acknowledgement' | 'comment' | null;
export type CertificateSignature = {
  engineerName?: string | null;
  engineerDate?: string | null;
  customerName?: string | null;
  customerDate?: string | null;
  customerApproval?: 'A' | 'AC' | 'N' | null;
  customerNote?: string | null;
};

export type ServiceStockUsage = Array<{
  id: number;
  quantity: any;
  txDate: Date;
  product: {
    sku: string;
    name: string;
    category: { name: string };
    unit: { name: string };
  };
}>;
