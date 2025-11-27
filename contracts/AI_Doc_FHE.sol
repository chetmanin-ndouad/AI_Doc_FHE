pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MedicalDiagnosis is ZamaEthereumConfig {
    struct PatientCase {
        address patientAddress;
        euint32 encryptedSymptoms;
        uint32 diagnosisResult;
        bool isDiagnosed;
        uint256 timestamp;
    }

    mapping(string => PatientCase) public cases;
    string[] public caseIds;

    event CaseCreated(string indexed caseId, address indexed patient);
    event DiagnosisComplete(string indexed caseId, uint32 result);

    constructor() ZamaEthereumConfig() {
    }

    function createCase(
        string calldata caseId,
        externalEuint32 encryptedSymptoms,
        bytes calldata inputProof
    ) external {
        require(bytes(cases[caseId].patientAddress).length == 0, "Case already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedSymptoms, inputProof)), "Invalid encrypted input");

        cases[caseId] = PatientCase({
            patientAddress: msg.sender,
            encryptedSymptoms: FHE.fromExternal(encryptedSymptoms, inputProof),
            diagnosisResult: 0,
            isDiagnosed: false,
            timestamp: block.timestamp
        });

        FHE.allowThis(cases[caseId].encryptedSymptoms);
        FHE.makePubliclyDecryptable(cases[caseId].encryptedSymptoms);

        caseIds.push(caseId);
        emit CaseCreated(caseId, msg.sender);
    }

    function diagnoseCase(
        string calldata caseId,
        bytes memory abiEncodedResult,
        bytes memory diagnosisProof
    ) external {
        require(bytes(cases[caseId].patientAddress).length > 0, "Case does not exist");
        require(!cases[caseId].isDiagnosed, "Case already diagnosed");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(cases[caseId].encryptedSymptoms);

        FHE.checkSignatures(cts, abiEncodedResult, diagnosisProof);

        uint32 result = abi.decode(abiEncodedResult, (uint32));
        cases[caseId].diagnosisResult = result;
        cases[caseId].isDiagnosed = true;

        emit DiagnosisComplete(caseId, result);
    }

    function getEncryptedSymptoms(string calldata caseId) external view returns (euint32) {
        require(bytes(cases[caseId].patientAddress).length > 0, "Case does not exist");
        return cases[caseId].encryptedSymptoms;
    }

    function getCaseDetails(string calldata caseId) external view returns (
        address patientAddress,
        uint32 diagnosisResult,
        bool isDiagnosed,
        uint256 timestamp
    ) {
        require(bytes(cases[caseId].patientAddress).length > 0, "Case does not exist");
        PatientCase storage c = cases[caseId];

        return (
            c.patientAddress,
            c.diagnosisResult,
            c.isDiagnosed,
            c.timestamp
        );
    }

    function getAllCaseIds() external view returns (string[] memory) {
        return caseIds;
    }

    function verifyContractActive() public pure returns (bool) {
        return true;
    }
}