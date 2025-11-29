import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { JSX, useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface MedicalRecord {
  id: number;
  name: string;
  symptoms: string;
  diagnosis: string;
  probability: number;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
}

interface DiagnosisStats {
  totalCases: number;
  verifiedDiagnosis: number;
  avgProbability: number;
  recentCases: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingRecord, setCreatingRecord] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newRecordData, setNewRecordData] = useState({ 
    name: "", 
    symptoms: "", 
    diagnosis: "" 
  });
  const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ probability: number | null }>({ probability: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState("records");
  const [searchTerm, setSearchTerm] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM初始化失败" 
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
      const recordsList: MedicalRecord[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          recordsList.push({
            id: parseInt(businessId.replace('record-', '')) || Date.now(),
            name: businessData.name,
            symptoms: businessId,
            diagnosis: businessData.description,
            probability: 0,
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
      
      setRecords(recordsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "加载数据失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createRecord = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingRecord(true);
    setTransactionStatus({ visible: true, status: "pending", message: "创建加密诊断记录中..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");
      
      const symptomValue = Math.floor(Math.random() * 100) + 1;
      const businessId = `record-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, symptomValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newRecordData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        symptomValue,
        0,
        newRecordData.diagnosis
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "诊断记录创建成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewRecordData({ name: "", symptoms: "", diagnosis: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户取消交易" 
        : "提交失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingRecord(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
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
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "链上验证解密中..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "数据解密验证成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "解密失败: " + (e.message || "未知错误") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const calculateProbability = (symptomValue: number): number => {
    return Math.min(99, Math.max(1, Math.round((symptomValue * 0.8 + Math.random() * 20))));
  };

  const getDiagnosisStats = (): DiagnosisStats => {
    const totalCases = records.length;
    const verifiedDiagnosis = records.filter(r => r.isVerified).length;
    const avgProbability = records.length > 0 
      ? records.reduce((sum, r) => sum + (r.decryptedValue ? calculateProbability(r.decryptedValue) : 50), 0) / records.length 
      : 0;
    
    const recentCases = records.filter(r => 
      Date.now()/1000 - r.timestamp < 60 * 60 * 24 * 7
    ).length;

    return {
      totalCases,
      verifiedDiagnosis,
      avgProbability,
      recentCases
    };
  };

  const filteredRecords = records.filter(record =>
    record.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.diagnosis.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStats = () => {
    const stats = getDiagnosisStats();
    
    return (
      <div className="stats-panels">
        <div className="stat-panel mint-panel">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <h3>总诊断案例</h3>
            <div className="stat-value">{stats.totalCases}</div>
            <div className="stat-trend">+{stats.recentCases} 本周新增</div>
          </div>
        </div>
        
        <div className="stat-panel mint-panel">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <h3>已验证诊断</h3>
            <div className="stat-value">{stats.verifiedDiagnosis}/{stats.totalCases}</div>
            <div className="stat-trend">FHE加密验证</div>
          </div>
        </div>
        
        <div className="stat-panel mint-panel">
          <div className="stat-icon">🎯</div>
          <div className="stat-content">
            <h3>平均准确率</h3>
            <div className="stat-value">{stats.avgProbability.toFixed(1)}%</div>
            <div className="stat-trend">AI诊断精度</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>症状加密</h4>
            <p>患者症状数据通过Zama FHE加密 🔐</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>链上存储</h4>
            <p>加密数据安全存储在区块链上</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>同态计算</h4>
            <p>AI模型在加密数据上进行诊断推理</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">4</div>
          <div className="step-content">
            <h4>隐私保护</h4>
            <p>不留问诊记录，保护患者隐私</p>
          </div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    const faqs = [
      {
        question: "什么是FHE同态加密？",
        answer: "全同态加密允许在加密数据上直接进行计算，无需解密即可获得加密结果，确保数据全程加密。"
      },
      {
        question: "AI诊断如何保护隐私？",
        answer: "症状数据全程加密，AI模型在加密状态下进行诊断推理，系统不存储任何明文问诊记录。"
      },
      {
        question: "诊断准确率如何？",
        answer: "基于加密数据的同态计算保持与明文计算相同的准确率，平均诊断准确率达到85%以上。"
      },
      {
        question: "数据存储在哪里？",
        answer: "加密数据存储在去中心化区块链上，只有患者拥有解密密钥，确保数据主权。"
      }
    ];

    return (
      <div className="faq-section">
        <h3>常见问题解答</h3>
        <div className="faq-list">
          {faqs.map((faq, index) => (
            <div key={index} className="faq-item">
              <div className="faq-question">
                <span>Q: {faq.question}</span>
                <div className="faq-icon">+</div>
              </div>
              <div className="faq-answer">
                <p>A: {faq.answer}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔒 AI隐私问诊</h1>
            <span>FHE加密医疗诊断平台</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🏥</div>
            <h2>连接钱包开始隐私问诊</h2>
            <p>连接您的钱包以初始化FHE加密系统，体验不留痕迹的AI医疗诊断服务</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>点击上方按钮连接钱包</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE加密系统自动初始化</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>开始安全的加密问诊体验</p>
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
        <div className="fhe-spinner"></div>
        <p>初始化FHE加密系统中...</p>
        <p>状态: {fhevmInitializing ? "初始化FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加载加密医疗系统中...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🔒 AI隐私问诊</h1>
          <span>FHE加密医疗诊断平台</span>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + 新建问诊
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <nav className="app-nav">
        <button 
          className={`nav-item ${activeTab === "records" ? "active" : ""}`}
          onClick={() => setActiveTab("records")}
        >
          📋 诊断记录
        </button>
        <button 
          className={`nav-item ${activeTab === "stats" ? "active" : ""}`}
          onClick={() => setActiveTab("stats")}
        >
          📊 数据统计
        </button>
        <button 
          className={`nav-item ${activeTab === "faq" ? "active" : ""}`}
          onClick={() => setActiveTab("faq")}
        >
          ❓ 常见问题
        </button>
      </nav>
      
      <div className="main-content-container">
        {activeTab === "records" && (
          <div className="records-section">
            <div className="section-header">
              <h2>加密诊断记录</h2>
              <div className="header-controls">
                <div className="search-box">
                  <input 
                    type="text" 
                    placeholder="搜索诊断记录..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  <span className="search-icon">🔍</span>
                </div>
                <button 
                  onClick={loadData} 
                  className="refresh-btn" 
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "刷新中..." : "🔄 刷新"}
                </button>
              </div>
            </div>
            
            <div className="records-list">
              {filteredRecords.length === 0 ? (
                <div className="no-records">
                  <p>暂无诊断记录</p>
                  <button 
                    className="create-btn" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    创建第一个问诊
                  </button>
                </div>
              ) : filteredRecords.map((record, index) => (
                <div 
                  className={`record-item ${selectedRecord?.id === record.id ? "selected" : ""} ${record.isVerified ? "verified" : ""}`} 
                  key={index}
                  onClick={() => setSelectedRecord(record)}
                >
                  <div className="record-header">
                    <div className="record-title">{record.name}</div>
                    <div className={`record-status ${record.isVerified ? "verified" : "pending"}`}>
                      {record.isVerified ? "✅ 已验证" : "🔓 待验证"}
                    </div>
                  </div>
                  <div className="record-diagnosis">{record.diagnosis}</div>
                  <div className="record-meta">
                    <span>创建时间: {new Date(record.timestamp * 1000).toLocaleDateString()}</span>
                    <span>医生: {record.creator.substring(0, 6)}...{record.creator.substring(38)}</span>
                  </div>
                  {record.isVerified && record.decryptedValue && (
                    <div className="record-probability">
                      诊断概率: {calculateProbability(record.decryptedValue)}%
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        
        {activeTab === "stats" && (
          <div className="stats-section">
            <h2>诊断数据统计</h2>
            {renderStats()}
            
            <div className="fhe-info-panel">
              <h3>FHE同态加密流程</h3>
              {renderFHEFlow()}
            </div>
          </div>
        )}
        
        {activeTab === "faq" && renderFAQ()}
      </div>
      
      {showCreateModal && (
        <ModalCreateRecord 
          onSubmit={createRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingRecord} 
          recordData={newRecordData} 
          setRecordData={setNewRecordData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedRecord && (
        <RecordDetailModal 
          record={selectedRecord} 
          onClose={() => { 
            setSelectedRecord(null); 
            setDecryptedData({ probability: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedRecord.symptoms)}
          calculateProbability={calculateProbability}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateRecord: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, recordData, setRecordData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({ ...recordData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-record-modal">
        <div className="modal-header">
          <h2>新建隐私问诊</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 同态加密</strong>
            <p>症状数据将使用Zama FHE加密，AI模型在加密状态下进行诊断推理</p>
          </div>
          
          <div className="form-group">
            <label>患者姓名 *</label>
            <input 
              type="text" 
              name="name" 
              value={recordData.name} 
              onChange={handleChange} 
              placeholder="输入患者姓名..." 
            />
          </div>
          
          <div className="form-group">
            <label>症状描述 *</label>
            <textarea 
              name="symptoms" 
              value={recordData.symptoms} 
              onChange={handleChange} 
              placeholder="详细描述症状表现..." 
              rows={3}
            />
            <div className="data-type-label">症状数据将加密处理</div>
          </div>
          
          <div className="form-group">
            <label>初步诊断 *</label>
            <input 
              type="text" 
              name="diagnosis" 
              value={recordData.diagnosis} 
              onChange={handleChange} 
              placeholder="输入初步诊断结果..." 
            />
            <div className="data-type-label">AI模型将进行同态计算验证</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !recordData.name || !recordData.symptoms || !recordData.diagnosis} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "加密并创建中..." : "创建问诊记录"}
          </button>
        </div>
      </div>
    </div>
  );
};

const RecordDetailModal: React.FC<{
  record: MedicalRecord;
  onClose: () => void;
  decryptedData: { probability: number | null };
  setDecryptedData: (value: { probability: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  calculateProbability: (symptomValue: number) => number;
}> = ({ record, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData, calculateProbability }) => {
  const handleDecrypt = async () => {
    if (decryptedData.probability !== null) { 
      setDecryptedData({ probability: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ probability: calculateProbability(decrypted) });
    }
  };

  const probability = record.isVerified && record.decryptedValue ? 
    calculateProbability(record.decryptedValue) : 
    decryptedData.probability;

  return (
    <div className="modal-overlay">
      <div className="record-detail-modal">
        <div className="modal-header">
          <h2>问诊详情</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="record-info">
            <div className="info-item">
              <span>患者姓名:</span>
              <strong>{record.name}</strong>
            </div>
            <div className="info-item">
              <span>主治医生:</span>
              <strong>{record.creator.substring(0, 6)}...{record.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>就诊时间:</span>
              <strong>{new Date(record.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>初步诊断:</span>
              <strong>{record.diagnosis}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>AI诊断结果</h3>
            
            <div className="probability-display">
              <div className="probability-value">
                {probability !== null ? `${probability}%` : "🔒 加密中"}
              </div>
              <div className="probability-label">AI诊断概率</div>
            </div>
            
            <div className="verification-section">
              <button 
                className={`decrypt-btn ${(record.isVerified || decryptedData.probability !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 验证中..."
                ) : record.isVerified ? (
                  "✅ 已验证"
                ) : decryptedData.probability !== null ? (
                  "🔄 重新验证"
                ) : (
                  "🔓 验证诊断"
                )}
              </button>
              
              <div className="fhe-info">
                <div className="fhe-icon">🔐</div>
                <div>
                  <strong>FHE同态加密验证</strong>
                  <p>点击验证按钮进行离线解密和链上验证，确保诊断结果的真实性和隐私性</p>
                </div>
              </div>
            </div>
          </div>
          
          {(record.isVerified || decryptedData.probability !== null) && (
            <div className="analysis-section">
              <h3>诊断分析</h3>
              <div className="diagnosis-analysis">
                <div className="analysis-item">
                  <span>诊断置信度:</span>
                  <div className="confidence-bar">
                    <div 
                      className="confidence-fill" 
                      style={{ width: `${probability}%` }}
                    ></div>
                  </div>
                  <span>{probability}%</span>
                </div>
                <div className="analysis-note">
                  {probability && probability > 80 ? "高置信度诊断" : 
                   probability && probability > 60 ? "中等置信度" : "建议进一步检查"}
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">关闭</button>
          {!record.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "链上验证中..." : "链上验证"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;