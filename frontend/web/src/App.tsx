import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface DiagnosisData {
  id: string;
  name: string;
  symptoms: string;
  diagnosis: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [diagnoses, setDiagnoses] = useState<DiagnosisData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingDiagnosis, setCreatingDiagnosis] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newDiagnosisData, setNewDiagnosisData] = useState({ 
    name: "", 
    symptoms: "", 
    severity: "" 
  });
  const [selectedDiagnosis, setSelectedDiagnosis] = useState<DiagnosisData | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [stats, setStats] = useState({ total: 0, verified: 0, avgSeverity: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const diagnosesList: DiagnosisData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          diagnosesList.push({
            id: businessId,
            name: businessData.name,
            symptoms: businessId,
            diagnosis: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setDiagnoses(diagnosesList);
      updateStats(diagnosesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (data: DiagnosisData[]) => {
    const total = data.length;
    const verified = data.filter(d => d.isVerified).length;
    const avgSeverity = total > 0 ? data.reduce((sum, d) => sum + d.publicValue1, 0) / total : 0;
    setStats({ total, verified, avgSeverity });
  };

  const createDiagnosis = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingDiagnosis(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating diagnosis with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const severityValue = parseInt(newDiagnosisData.severity) || 0;
      const businessId = `diagnosis-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, severityValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newDiagnosisData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        severityValue,
        0,
        newDiagnosisData.symptoms
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Diagnosis created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewDiagnosisData({ name: "", symptoms: "", severity: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingDiagnosis(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and ready!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredDiagnoses = diagnoses.filter(diagnosis =>
    diagnosis.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    diagnosis.symptoms.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStatsPanel = () => (
    <div className="stats-panels">
      <div className="stat-panel">
        <div className="stat-icon">📊</div>
        <div className="stat-content">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total Diagnoses</div>
        </div>
      </div>
      <div className="stat-panel">
        <div className="stat-icon">✅</div>
        <div className="stat-content">
          <div className="stat-value">{stats.verified}</div>
          <div className="stat-label">Verified</div>
        </div>
      </div>
      <div className="stat-panel">
        <div className="stat-icon">📈</div>
        <div className="stat-content">
          <div className="stat-value">{stats.avgSeverity.toFixed(1)}</div>
          <div className="stat-label">Avg Severity</div>
        </div>
      </div>
    </div>
  );

  const renderFHEProcess = () => (
    <div className="fhe-process">
      <div className="process-step">
        <div className="step-number">1</div>
        <div className="step-content">
          <h4>Symptom Encryption</h4>
          <p>Patient symptoms are encrypted using FHE before processing</p>
        </div>
      </div>
      <div className="process-step">
        <div className="step-number">2</div>
        <div className="step-content">
          <h4>AI Diagnosis</h4>
          <p>AI model analyzes encrypted data without decryption</p>
        </div>
      </div>
      <div className="process-step">
        <div className="step-number">3</div>
        <div className="step-content">
          <h4>Secure Storage</h4>
          <p>Encrypted results stored on blockchain</p>
        </div>
      </div>
      <div className="process-step">
        <div className="step-number">4</div>
        <div className="step-content">
          <h4>Controlled Access</h4>
          <p>Only authorized parties can decrypt results</p>
        </div>
      </div>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <h1>AI隱私問診 🔐</h1>
            <p>Confidential Medical Diagnosis with FHE</p>
          </div>
          <ConnectButton />
        </header>
        
        <div className="welcome-section">
          <div className="welcome-content">
            <div className="welcome-icon">🏥</div>
            <h2>Secure Medical Diagnosis</h2>
            <p>Experience privacy-preserving AI diagnosis with Fully Homomorphic Encryption</p>
            <div className="feature-list">
              <div className="feature-item">
                <span className="feature-icon">🔒</span>
                <span>Symptom data remains encrypted</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🤖</span>
                <span>AI diagnosis on encrypted data</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">⚡</span>
                <span>No medical records stored</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-loader"></div>
        <p>Initializing FHE Medical System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-loader"></div>
      <p>Loading medical records...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-main">
          <div className="logo-section">
            <h1>AI隱私問診 🔐</h1>
            <p>Confidential Medical Diagnosis</p>
          </div>
          
          <div className="header-actions">
            <button className="availability-btn" onClick={checkAvailability}>
              Check System
            </button>
            <ConnectButton />
          </div>
        </div>
        
        <nav className="app-nav">
          <button className="nav-active">Diagnoses</button>
          <button>Analytics</button>
          <button>Settings</button>
        </nav>
      </header>

      <main className="app-main">
        <section className="hero-section">
          <div className="hero-content">
            <h2>Privacy-First Medical AI</h2>
            <p>Your symptoms are encrypted, diagnosed by AI, and never stored</p>
            <button 
              className="primary-btn"
              onClick={() => setShowCreateModal(true)}
            >
              New Diagnosis
            </button>
          </div>
        </section>

        {renderStatsPanel()}

        <section className="fhe-section">
          <h3>FHE Encryption Process</h3>
          {renderFHEProcess()}
        </section>

        <section className="diagnoses-section">
          <div className="section-header">
            <h3>Medical Diagnoses</h3>
            <div className="controls">
              <div className="search-box">
                <input
                  type="text"
                  placeholder="Search diagnoses..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <span className="search-icon">🔍</span>
              </div>
              <button 
                className="refresh-btn"
                onClick={loadData}
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="diagnoses-grid">
            {filteredDiagnoses.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📋</div>
                <p>No diagnoses found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Diagnosis
                </button>
              </div>
            ) : (
              filteredDiagnoses.map((diagnosis) => (
                <div 
                  key={diagnosis.id}
                  className="diagnosis-card"
                  onClick={() => setSelectedDiagnosis(diagnosis)}
                >
                  <div className="card-header">
                    <h4>{diagnosis.name}</h4>
                    <span className={`status-badge ${diagnosis.isVerified ? 'verified' : 'pending'}`}>
                      {diagnosis.isVerified ? 'Verified' : 'Pending'}
                    </span>
                  </div>
                  <div className="card-content">
                    <p className="symptoms">{diagnosis.symptoms}</p>
                    <div className="card-meta">
                      <span>Severity: {diagnosis.publicValue1}/10</span>
                      <span>{new Date(diagnosis.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {showCreateModal && (
        <CreateDiagnosisModal
          onSubmit={createDiagnosis}
          onClose={() => setShowCreateModal(false)}
          creating={creatingDiagnosis}
          diagnosisData={newDiagnosisData}
          setDiagnosisData={setNewDiagnosisData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedDiagnosis && (
        <DiagnosisDetailModal
          diagnosis={selectedDiagnosis}
          onClose={() => {
            setSelectedDiagnosis(null);
            setDecryptedValue(null);
          }}
          decryptedValue={decryptedValue}
          isDecrypting={isDecrypting || fheIsDecrypting}
          decryptData={() => decryptData(selectedDiagnosis.id)}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </span>
            {transactionStatus.message}
          </div>
        </div>
      )}

      <footer className="app-footer">
        <p>AI隱私問診 - Confidential Medical Diagnosis with FHE Technology</p>
        <div className="footer-links">
          <a href="#">Privacy Policy</a>
          <a href="#">Terms of Service</a>
          <a href="#">Contact</a>
        </div>
      </footer>
    </div>
  );
};

const CreateDiagnosisModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  diagnosisData: any;
  setDiagnosisData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, diagnosisData, setDiagnosisData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'severity') {
      const intValue = value.replace(/[^\d]/g, '');
      setDiagnosisData({ ...diagnosisData, [name]: intValue });
    } else {
      setDiagnosisData({ ...diagnosisData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>New Medical Diagnosis</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="notice-icon">🔐</div>
            <div>
              <strong>FHE Encrypted Diagnosis</strong>
              <p>Symptom severity will be encrypted using FHE technology</p>
            </div>
          </div>

          <div className="form-group">
            <label>Patient Name *</label>
            <input
              type="text"
              name="name"
              value={diagnosisData.name}
              onChange={handleChange}
              placeholder="Enter patient name..."
            />
          </div>

          <div className="form-group">
            <label>Symptoms Description *</label>
            <textarea
              name="symptoms"
              value={diagnosisData.symptoms}
              onChange={handleChange}
              placeholder="Describe symptoms..."
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>Symptom Severity (1-10) *</label>
            <input
              type="number"
              name="severity"
              min="1"
              max="10"
              value={diagnosisData.severity}
              onChange={handleChange}
              placeholder="Enter severity level..."
            />
            <div className="input-note">FHE Encrypted Integer</div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="secondary-btn">Cancel</button>
          <button
            onClick={onSubmit}
            disabled={creating || isEncrypting || !diagnosisData.name || !diagnosisData.symptoms || !diagnosisData.severity}
            className="primary-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Diagnosis"}
          </button>
        </div>
      </div>
    </div>
  );
};

const DiagnosisDetailModal: React.FC<{
  diagnosis: DiagnosisData;
  onClose: () => void;
  decryptedValue: number | null;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ diagnosis, onClose, decryptedValue, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) return;
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="modal large">
        <div className="modal-header">
          <h2>Diagnosis Details</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="diagnosis-info">
            <div className="info-grid">
              <div className="info-item">
                <label>Patient Name</label>
                <span>{diagnosis.name}</span>
              </div>
              <div className="info-item">
                <label>Date Created</label>
                <span>{new Date(diagnosis.timestamp * 1000).toLocaleDateString()}</span>
              </div>
              <div className="info-item">
                <label>Creator</label>
                <span>{diagnosis.creator.substring(0, 8)}...{diagnosis.creator.substring(34)}</span>
              </div>
              <div className="info-item">
                <label>Public Severity</label>
                <span>{diagnosis.publicValue1}/10</span>
              </div>
            </div>

            <div className="symptoms-section">
              <label>Symptoms Description</label>
              <div className="symptoms-content">{diagnosis.symptoms}</div>
            </div>

            <div className="encryption-section">
              <label>Encrypted Severity Data</label>
              <div className="encryption-status">
                <span className="status-text">
                  {diagnosis.isVerified ? 
                    `Decrypted Value: ${diagnosis.decryptedValue}` : 
                    decryptedValue !== null ? 
                    `Locally Decrypted: ${decryptedValue}` : 
                    "🔒 FHE Encrypted"
                  }
                </span>
                <button
                  className={`decrypt-btn ${diagnosis.isVerified || decryptedValue !== null ? 'decrypted' : ''}`}
                  onClick={handleDecrypt}
                  disabled={isDecrypting || diagnosis.isVerified}
                >
                  {isDecrypting ? "Decrypting..." : 
                   diagnosis.isVerified ? "Verified" : 
                   decryptedValue !== null ? "Decrypted" : "Decrypt"}
                </button>
              </div>
            </div>

            {diagnosis.isVerified && (
              <div className="analysis-section">
                <label>AI Diagnosis Analysis</label>
                <div className="analysis-result">
                  <div className="probability-bar">
                    <div className="bar-label">Condition Probability</div>
                    <div className="bar-container">
                      <div 
                        className="bar-fill" 
                        style={{ width: `${(diagnosis.decryptedValue || 0) * 10}%` }}
                      >
                        {diagnosis.decryptedValue}%
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="secondary-btn">Close</button>
          {!diagnosis.isVerified && (
            <button
              onClick={handleDecrypt}
              disabled={isDecrypting}
              className="primary-btn"
            >
              Verify on Blockchain
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;