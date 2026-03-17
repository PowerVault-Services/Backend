import fs from 'fs';
import { resolveFromProjectRoot } from '../config/runtimePaths';

export const POWER_VAULT_SIGNATURE_LOGO_CID = 'powervault-signature-logo';
const SIGNATURE_START = '<!-- PV_EMAIL_SIGNATURE_START -->';
const SIGNATURE_END = '<!-- PV_EMAIL_SIGNATURE_END -->';

export type EmailSignatureInput = {
  signatureKey?: string | null;
  signatureName?: string | null;
  signatureRoleLabel?: string | null;
  signaturePhone?: string | null;
  signatureDepartment?: string | null;
  signatureCompany?: string | null;
  signatureAddress?: string | null;
  signatureWebsite?: string | null;
  signatureCountry?: string | null;
};

type EmailSignatureProfile = {
  key: string;
  label: string;
  name: string;
  roleLabel: string;
  phone: string;
  department: string;
  company: string;
  address: string;
  website: string;
  country: string;
};

const DEFAULT_PROFILE: EmailSignatureProfile = {
  key: 'palm',
  label: 'Palm',
  name: 'Duangkamon Kuikeaw (Palm)',
  roleLabel: 'Contract Person',
  phone: '0925359978',
  department: 'Support Service',
  company: 'PowerVault Service Co., Ltd.',
  address: '407 Moo 2, Samrong Nuea, Muang Samutprakarn, Samutprakarn 10270',
  website: 'https://www.powervaultthailand.com',
  country: 'THAILAND',
};

const PRESET_SIGNATURES: EmailSignatureProfile[] = [
  DEFAULT_PROFILE,
  {
    key: 'support-team',
    label: 'PowerVault Support Team',
    name: 'PowerVault Support Team',
    roleLabel: 'Contact Person',
    phone: '02-397-1137',
    department: 'Support Service',
    company: 'PowerVault Service Co., Ltd.',
    address: '407 Moo 2, Samrong Nuea, Muang Samutprakarn, Samutprakarn 10270',
    website: 'https://www.powervaultthailand.com',
    country: 'THAILAND',
  },
];

function esc(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string) {
  return esc(value).replace(/`/g, '&#96;');
}

function stripGeneratedSignature(html: string) {
  return String(html ?? '').replace(/<!-- PV_EMAIL_SIGNATURE_START -->[\s\S]*?<!-- PV_EMAIL_SIGNATURE_END -->/gi, '').trim();
}

function hasGeneratedSignature(html: string) {
  return /<!-- PV_EMAIL_SIGNATURE_START -->[\s\S]*?<!-- PV_EMAIL_SIGNATURE_END -->/i.test(String(html ?? ''));
}

export function hasExplicitEmailSignatureInput(input?: EmailSignatureInput | null) {
  if (!input) return false;
  return Object.values(input).some((value) => String(value ?? '').trim() !== '');
}

export function extractEmailSignatureInput(raw: any): EmailSignatureInput | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const picked: EmailSignatureInput = {
    signatureKey: raw.signatureKey ?? raw.signKey ?? raw.signerKey ?? null,
    signatureName: raw.signatureName ?? raw.signerName ?? raw.contactPersonName ?? null,
    signatureRoleLabel: raw.signatureRoleLabel ?? raw.signaturePhoneLabel ?? raw.signerRoleLabel ?? null,
    signaturePhone: raw.signaturePhone ?? raw.signerPhone ?? raw.contactPersonPhone ?? null,
    signatureDepartment: raw.signatureDepartment ?? raw.signerDepartment ?? raw.department ?? null,
    signatureCompany: raw.signatureCompany ?? raw.signerCompany ?? null,
    signatureAddress: raw.signatureAddress ?? raw.signerAddress ?? null,
    signatureWebsite: raw.signatureWebsite ?? raw.signerWebsite ?? null,
    signatureCountry: raw.signatureCountry ?? raw.signerCountry ?? null,
  };

  return hasExplicitEmailSignatureInput(picked) ? picked : undefined;
}

function resolveEmailSignatureProfile(input?: EmailSignatureInput | null): EmailSignatureProfile {
  const signatureKey = String(input?.signatureKey ?? DEFAULT_PROFILE.key).trim().toLowerCase();
  const preset = PRESET_SIGNATURES.find((item) => item.key.toLowerCase() === signatureKey) ?? DEFAULT_PROFILE;

  return {
    ...preset,
    name: String(input?.signatureName ?? preset.name).trim() || preset.name,
    roleLabel: String(input?.signatureRoleLabel ?? preset.roleLabel).trim() || preset.roleLabel,
    phone: String(input?.signaturePhone ?? preset.phone).trim() || preset.phone,
    department: String(input?.signatureDepartment ?? preset.department).trim() || preset.department,
    company: String(input?.signatureCompany ?? preset.company).trim() || preset.company,
    address: String(input?.signatureAddress ?? preset.address).trim() || preset.address,
    website: String(input?.signatureWebsite ?? preset.website).trim() || preset.website,
    country: String(input?.signatureCountry ?? preset.country).trim() || preset.country,
  };
}

export function buildEmailSignatureHtml(input?: EmailSignatureInput | null) {
  const profile = resolveEmailSignatureProfile(input);
  const websiteHref = profile.website.startsWith('http') ? profile.website : `https://${profile.website}`;
  const websiteLabel = profile.website.replace(/^https?:\/\//i, '');

  return `${SIGNATURE_START}
<div data-pv-email-signature="true" style="margin-top:24px;font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.45;">
  <div style="color:#6b7280;">--</div>
  <div style="margin-top:8px;">Best Regards,</div>
  <div style="margin-top:6px;font-size:16px;font-weight:700;">${esc(profile.name)}</div>
  <div style="font-weight:700;">${esc(profile.roleLabel)}: ${esc(profile.phone)}</div>
  <div style="font-weight:700;">(${esc(profile.department)})</div>
  <div style="font-weight:700;">${esc(profile.company)}</div>
  <div>${esc(profile.address)}</div>
  <div>Tel. ${esc(profile.phone)}</div>
  <div>Website: <a href="${escapeAttr(websiteHref)}" target="_blank" rel="noopener noreferrer">${esc(websiteLabel)}</a></div>
  <div>${esc(profile.country)}</div>
  <div style="margin-top:12px;">
    <img src="cid:${POWER_VAULT_SIGNATURE_LOGO_CID}" alt="PowerVault Service" style="display:block;max-width:220px;height:auto;border:0;" />
  </div>
</div>
${SIGNATURE_END}`;
}

export function applyEmailSignature(html: string, input?: EmailSignatureInput | null) {
  const source = String(html ?? '');
  const generatedAlready = hasGeneratedSignature(source);

  if (generatedAlready && !hasExplicitEmailSignatureInput(input)) {
    return source;
  }

  const contentWithoutSignature = stripGeneratedSignature(source);
  const signatureHtml = buildEmailSignatureHtml(input);

  if (!contentWithoutSignature) return signatureHtml;
  return `${contentWithoutSignature}\n\n${signatureHtml}`;
}

export function getEmailSignaturePresets() {
  return PRESET_SIGNATURES.map(({ key, label, name, roleLabel, phone, department, company, address, website, country }) => ({
    key,
    label,
    name,
    roleLabel,
    phone,
    department,
    company,
    address,
    website,
    country,
  }));
}

export function getEmailSignatureLogoAttachment() {
  const logoPath = resolveFromProjectRoot('assets', 'powervault-logo.png');
  if (!fs.existsSync(logoPath)) return null;

  return {
    filename: 'powervault-logo.png',
    path: logoPath,
    cid: POWER_VAULT_SIGNATURE_LOGO_CID,
  };
}

export function emailHtmlUsesPowerVaultSignatureLogo(html: string) {
  return String(html ?? '').includes(`cid:${POWER_VAULT_SIGNATURE_LOGO_CID}`);
}

export function getEmailSignatureMarkers() {
  return { start: SIGNATURE_START, end: SIGNATURE_END };
}
