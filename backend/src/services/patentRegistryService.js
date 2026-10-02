export const DEFAULT_ADMIN =
  process.env.PATENT_ADMIN_ADDRESS ||
  'GPATENTADMIN000000000000000000000000000000000000';
export const DEFAULT_VERIFIER =
  process.env.PATENT_VERIFIER_ADDRESS ||
  'GPATENTVERIFIER000000000000000000000000000000000000';

const MAX_TITLE_LENGTH = 200;
const MAX_URI_LENGTH = 512;
const MAX_HASH_LENGTH = 128;
const MAX_TERMS_LENGTH = 2000;
const MAX_PAYMENT_AMOUNT = 1e18;

function nowIso() {
  return new Date().toISOString();
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class PatentRegistryService {
  constructor() {
    this.reset();
  }

  reset() {
    this.patents = [];
    this.licenses = [];
    this.patentSeq = 1;
    this.licenseSeq = 1;
    this.admin = DEFAULT_ADMIN;
    this.verifier = DEFAULT_VERIFIER;
    this.paused = false;
    this.disputes = [];
    this.disputeSeq = 1;
    this.escrows = new Map();
    this.cachedDashboard = null;
    this.cacheExpiresAt = 0;
  }

  getConfig() {
    return {
      adminAddress: this.admin,
      verifierAddress: this.verifier,
      maxTitleLength: MAX_TITLE_LENGTH,
      maxUriLength: MAX_URI_LENGTH,
    };
  }

  async getDashboard() {
    if (this.cachedDashboard && Date.now() < this.cacheExpiresAt) {
      return clone(this.cachedDashboard);
    }

    const patents = this.listPatents();
    const payload = {
      patents,
      licenses: this.listLicenses(),
      metrics: {
        patentCount: patents.length,
        verifiedCount: patents.filter((p) => p.status === 'Verified').length,
        licenseCount: this.licenses.length,
        activeOffers: this.licenses.filter((l) => l.status === 'Open').length,
        acceptedLicenses: this.licenses.filter((l) => l.status === 'Accepted').length,
        disputedLicenses: this.licenses.filter((l) => l.status === 'Disputed').length,
        openDisputes: this.disputes.filter((d) => d.status === 'Open').length,
        totalPayments: this.licenses.reduce(
          (sum, l) => sum + (l.payment_amount || 0),
          0
        ),
      },
      config: this.getConfig(),
      paused: this.paused,
    };

    this.cachedDashboard = payload;
    this.cacheExpiresAt = Date.now() + 30_000;
    return clone(payload);
  }

  _validateString(value, field, maxLength) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Invalid ${field}`);
    }
    if (value.length > maxLength) {
      throw new Error(`${field} exceeds maximum length`);
    }
    return value;
  }

  registerPatent(owner, title, metadata_uri, metadata_hash) {
    if (this.paused) {
      throw new Error('Contract is paused');
    }
    if (!owner || !title || !metadata_uri || !metadata_hash) {
      throw new Error('Invalid patent input');
    }
    this._validateString(title, 'title', MAX_TITLE_LENGTH);
    this._validateString(metadata_uri, 'metadata_uri', MAX_URI_LENGTH);
    this._validateString(metadata_hash, 'metadata_hash', MAX_HASH_LENGTH);

    const patent = {
      id: this.patentSeq++,
      owner,
      title,
      metadata_uri,
      metadata_hash,
      status: 'Registered',
      created_at: nowSeconds(),
      updated_at: nowSeconds(),
      verified_at: null,
    };

    this.patents.push(patent);
    return clone(patent);
  }

  updatePatent(owner, patent_id, title, metadata_uri, metadata_hash) {
    if (this.paused) {
      throw new Error('Contract is paused');
    }

    const patent = this.patents.find((p) => p.id === patent_id);
    if (!patent) {
      throw new Error('Patent not found');
    }
    if (patent.owner !== owner) {
      throw new Error('Not patent owner');
    }
    this._validateString(title, 'title', MAX_TITLE_LENGTH);
    this._validateString(metadata_uri, 'metadata_uri', MAX_URI_LENGTH);
    this._validateString(metadata_hash, 'metadata_hash', MAX_HASH_LENGTH);

    patent.title = title;
    patent.metadata_uri = metadata_uri;
    patent.metadata_hash = metadata_hash;
    patent.updated_at = nowSeconds();

    return clone(patent);
  }

  verifyPatent(verifier, patent_id) {
    if (this.paused) {
      throw new Error('Contract is paused');
    }
    if (verifier !== this.verifier) {
      throw new Error('Not verifier');
    }

    const patent = this.patents.find((p) => p.id === patent_id);
    if (!patent) {
      throw new Error('Patent not found');
    }
    if (patent.status === 'Verified') {
      throw new Error('Already verified');
    }

    patent.status = 'Verified';
    patent.verified_at = nowSeconds();
    patent.updated_at = nowSeconds();

    return clone(patent);
  }

  createLicenseOffer(
    owner,
    patent_id,
    licensee,
    terms,
    payment_amount,
    payment_currency
  ) {
    if (this.paused) {
      throw new Error('Contract is paused');
    }

    const patent = this.patents.find((p) => p.id === patent_id);
    if (!patent) {
      throw new Error('Patent not found');
    }
    if (patent.owner !== owner) {
      throw new Error('Not patent owner');
    }
    if (patent.status !== 'Verified') {
      throw new Error('Patent not verified');
    }
    if (!licensee) {
      throw new Error('Invalid licensee');
    }
    this._validateString(terms, 'terms', MAX_TERMS_LENGTH);
    if (typeof payment_amount !== 'number' || payment_amount < 0 || payment_amount > MAX_PAYMENT_AMOUNT) {
      throw new Error('Invalid payment amount');
    }
    if (!payment_currency) {
      throw new Error('Invalid payment currency');
    }

    const license = {
      id: this.licenseSeq++,
      patent_id,
      licensor: owner,
      licensee,
      terms,
      payment_amount,
      payment_currency,
      status: 'Open',
      created_at: nowSeconds(),
      accepted_at: null,
      payment_reference: null,
    };

    this.licenses.push(license);
    return clone(license);
  }

  acceptLicense(licensee, patent_id, license_id, payment_reference) {
    if (this.paused) {
      throw new Error('Contract is paused');
    }

    const license = this.licenses.find((l) => l.id === license_id);
    if (!license) {
      throw new Error('License not found');
    }
    if (license.licensee !== licensee) {
      throw new Error('Unauthorized');
    }
    if (license.status !== 'Open') {
      throw new Error('License already accepted');
    }
    if (!payment_reference) {
      throw new Error('Invalid payment reference');
    }

    license.status = 'Accepted';
    license.accepted_at = nowSeconds();
    license.payment_reference = payment_reference;

    return clone(license);
  }

  createEscrow(licensee, license_id, amount, currency) {
    if (this.paused) {
      throw new Error('Contract is paused');
    }
    const license = this.licenses.find((l) => l.id === license_id);
    if (!license) {
      throw new Error('License not found');
    }
    if (license.licensee !== licensee) {
      throw new Error('Unauthorized');
    }
    if (license.status !== 'Open') {
      throw new Error('License not open');
    }
    if (typeof amount !== 'number' || amount <= 0 || amount > MAX_PAYMENT_AMOUNT) {
      throw new Error('Invalid escrow amount');
    }
    if (amount !== license.payment_amount || currency !== license.payment_currency) {
      throw new Error('Escrow terms mismatch');
    }
    const escrow = {
      license_id,
      depositor: licensee,
      amount,
      currency,
      status: 'Held',
      created_at: nowSeconds(),
      released_at: null,
      refunded_at: null,
    };
    this.escrows.set(license_id, escrow);
    this.cachedDashboard = null;
    return clone(escrow);
  }

  releaseEscrow(admin, license_id) {
    if (admin !== this.admin) {
      throw new Error('Not admin');
    }
    const escrow = this.escrows.get(license_id);
    if (!escrow) {
      throw new Error('Escrow not found');
    }
    if (escrow.status !== 'Held') {
      throw new Error('Escrow not held');
    }
    escrow.status = 'Released';
    escrow.released_at = nowSeconds();
    this.cachedDashboard = null;
    return clone(escrow);
  }

  refundEscrow(admin, license_id) {
    if (admin !== this.admin) {
      throw new Error('Not admin');
    }
    const escrow = this.escrows.get(license_id);
    if (!escrow) {
      throw new Error('Escrow not found');
    }
    if (escrow.status !== 'Held') {
      throw new Error('Escrow not held');
    }
    escrow.status = 'Refunded';
    escrow.refunded_at = nowSeconds();
    this.cachedDashboard = null;
    return clone(escrow);
  }

  getEscrow(license_id) {
    const escrow = this.escrows.get(license_id);
    if (!escrow) {
      throw new Error('Escrow not found');
    }
    return clone(escrow);
  }

  openDispute(complainant, license_id, reason) {
    if (this.paused) {
      throw new Error('Contract is paused');
    }
    const license = this.licenses.find((l) => l.id === license_id);
    if (!license) {
      throw new Error('License not found');
    }
    if (license.licensor !== complainant && license.licensee !== complainant) {
      throw new Error('Unauthorized');
    }
    this._validateString(reason, 'reason', MAX_TERMS_LENGTH);
    if (license.status === 'Disputed') {
      throw new Error('License already disputed');
    }
    license.status = 'Disputed';
    const dispute = {
      id: this.disputeSeq++,
      license_id,
      complainant,
      reason,
      status: 'Open',
      created_at: nowSeconds(),
      resolved_at: null,
      resolution: null,
    };
    this.disputes.push(dispute);
    this.cachedDashboard = null;
    return clone(dispute);
  }

  resolveDispute(admin, dispute_id, resolution) {
    if (admin !== this.admin) {
      throw new Error('Not admin');
    }
    const dispute = this.disputes.find((d) => d.id === dispute_id);
    if (!dispute) {
      throw new Error('Dispute not found');
    }
    if (dispute.status !== 'Open') {
      throw new Error('Dispute already resolved');
    }
    this._validateString(resolution, 'resolution', MAX_TERMS_LENGTH);
    dispute.status = 'Resolved';
    dispute.resolution = resolution;
    dispute.resolved_at = nowSeconds();
    const license = this.licenses.find((l) => l.id === dispute.license_id);
    if (license && license.status === 'Disputed') {
      license.status = 'Resolved';
    }
    this.cachedDashboard = null;
    return clone(dispute);
  }

  listDisputes() {
    return clone(this.disputes.slice().sort((a, b) => b.id - a.id));
  }

  getDispute(dispute_id) {
    const dispute = this.disputes.find((d) => d.id === dispute_id);
    if (!dispute) {
      throw new Error('Dispute not found');
    }
    return clone(dispute);
  }

  getPatent(patent_id) {
    const patent = this.patents.find((p) => p.id === patent_id);
    if (!patent) {
      throw new Error('Patent not found');
    }
    return clone(patent);
  }

  getLicense(license_id) {
    const license = this.licenses.find((l) => l.id === license_id);
    if (!license) {
      throw new Error('License not found');
    }
    return clone(license);
  }

  listPatents() {
    return clone(
      this.patents
        .map((patent) => ({
          ...patent,
        }))
        .sort((a, b) => b.id - a.id)
    );
  }

  listLicenses() {
    return clone(
      this.licenses
        .map((license) => ({
          ...license,
        }))
        .sort((a, b) => b.id - a.id)
    );
  }

  getLicensesByPatent(patent_id) {
    return clone(
      this.licenses
        .filter((l) => l.patent_id === patent_id)
        .sort((a, b) => b.id - a.id)
    );
  }

  setVerifier(admin, verifier) {
    if (admin !== this.admin) {
      throw new Error('Not admin');
    }
    this.verifier = verifier;
    this.cachedDashboard = null;
    this.cacheExpiresAt = 0;
  }

  pause(admin) {
    if (admin !== this.admin) {
      throw new Error('Not admin');
    }
    this.paused = true;
    this.cachedDashboard = null;
    this.cacheExpiresAt = 0;
  }

  unpause(admin) {
    if (admin !== this.admin) {
      throw new Error('Not admin');
    }
    this.paused = false;
    this.cachedDashboard = null;
    this.cacheExpiresAt = 0;
  }

  isPaused() {
    return this.paused;
  }

  getAdmin() {
    return this.admin;
  }

  getVerifier() {
    return this.verifier;
  }
}

const patentRegistryService = new PatentRegistryService();
export default patentRegistryService;
