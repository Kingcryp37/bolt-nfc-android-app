import {Platform} from 'react-native';
import NfcManager, {NfcTech, Ndef} from 'react-native-nfc-manager';
import {randomBytes} from 'crypto';
import crc from 'crc';

var CryptoJS = require('../utils/Cmac');
var AES = require('crypto-js/aes');

function hexToBytes(hex) {
  let bytes = [];
  for (let c = 0; c < hex.length; c += 2)
    bytes.push(parseInt(hex.substr(c, 2), 16));
  return bytes;
}

// Convert a byte array to a hex string
function bytesToHex(bytes) {
  let hex = [];
  for (let i = 0; i < bytes.length; i++) {
    let current = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    hex.push((current >>> 4).toString(16));
    hex.push((current & 0xf).toString(16));
  }
  return hex.join('');
}

function leftRotate(bytesArr, rotatebit = 1) {
  let first = bytesArr.shift();
  bytesArr.push(first);
  return bytesArr;
}

//Encrypted IV
function ivEncryption(ti, cmdCtr, sesAuthEncKey) {
  const ivData = AES.encrypt(
    CryptoJS.enc.Hex.parse('A55A' + ti + cmdCtr + '0000000000000000'),
    CryptoJS.enc.Hex.parse(sesAuthEncKey),
    {
      mode: CryptoJS.mode.ECB,
      // iv: CryptoJS.enc.Hex.parse("00000000000000000000000000000000"),
      keySize: 128 / 8,
      padding: CryptoJS.pad.NoPadding,
    },
  );
  return ivData.ciphertext.toString(CryptoJS.enc.Hex);
}

function ivEncryptionResponse(ti, cmdCtr, sesAuthEncKey) {
  const ivData = AES.encrypt(
    CryptoJS.enc.Hex.parse('5AA5' + ti + cmdCtr + '0000000000000000'),
    CryptoJS.enc.Hex.parse(sesAuthEncKey),
    {
      mode: CryptoJS.mode.ECB,
      // iv: CryptoJS.enc.Hex.parse("00000000000000000000000000000000"),
      keySize: 128 / 8,
      padding: CryptoJS.pad.NoPadding,
    },
  );
  return ivData.ciphertext.toString(CryptoJS.enc.Hex);
}

function padForEnc(data, byteLen) {
  console.log('padforenc', data, data.length, byteLen);
  var paddedData = data;
  if (data.length < byteLen * 2) {
    console.log('padforEnc22', byteLen * 2);
    paddedData += '80';
    paddedData = paddedData.padEnd(byteLen * 2, '00');
  }
  return paddedData;
}
/**
 * Decimal to Hex Least sig bytes first
 * @param {int} dec decimal value
 * @param {int} bytes how many bytes you want the hex to be
 * @returns 
 */
function decToHexLsbFirst(dec, bytes) {
  //lsb first
  return dec
    .toString(16)
    .padStart(2, '0')
    .padEnd(bytes * 2, '0');
}

const Ntag424 = NfcManager;
Ntag424.ti = null;
Ntag424.sesAuthEncKey = null;
Ntag424.sesAuthMacKey = null;
Ntag424.cmdCtrDec = null;

/**
 * Sends the ADPU command using appropriate function for ios / android
 * creates the same return object for each platform
 * 
 * @param {byte[]} commandBytes 
 * @returns {response, sw1, sw2}
 */
Ntag424.sendAPDUCommand = async function (commandBytes) {
  const response =
    Platform.OS == 'ios'
      ? await NfcManager.sendCommandAPDUIOS(commandBytes)
      : await NfcManager.transceive(commandBytes);
  var newResponse = response;
  if (Platform.OS == 'android') {
    newResponse = {};
    newResponse.response = response.slice(0, -2);
    newResponse.sw1 = response.slice(-2, -1);
    newResponse.sw2 = response.slice(-1);
  }
  return newResponse;
};

/**
 * Selects the application file
 * @returns 
 */
Ntag424.isoSelectFileApplication = async function () {
  //For selecting the application immediately, the ISO/IEC 7816-4 DF name D2760000850101h can be used.
  const isoSelectFileBytes = hexToBytes('00A4040007D276000085010100');
  const isoSelectRes = await Ntag424.sendAPDUCommand(isoSelectFileBytes);
  console.warn(
    'isoSelectRes: ',
    bytesToHex([isoSelectRes.sw1, isoSelectRes.sw2]),
  );
  const resultHex = bytesToHex([isoSelectRes.sw1, isoSelectRes.sw2]);
  if(resultHex == '9000') {
    return Promise.resolve(resultHex);
  } else {
    const errorCodes = new Object();
    errorCodes['6700'] = 'Wrong or inconsistent APDU length.';
    errorCodes['6985'] = 'Wrapped chained command or multiple pass command ongoing.';
    errorCodes['6a82'] = 'Application or file not found, currently selected application remains selected.';
    errorCodes['6a86'] = 'Wrong parameter P1 and/or P2';
    errorCodes['6a87'] = 'Wrong parameter Lc inconsistent with P1-P2';
    errorCodes['6e00'] = 'Wrong CLA';
    return Promise.reject('ISO Select File Failed, code ' +resultHex + ' ' + errorCodes[resultHex] );
  }
}

/**
 * AuthEv2First
 * COMMMODE N/A
 * @param {string} keyNo key number in hex (1 byte)
 * @param {string} pKey key value in hex (16 bytes)
 * @returns 
 * 
 * CommMode N/A
 */
Ntag424.AuthEv2First = async function (keyNo, pKey) {
  //iso select file before auth
  await Ntag424.isoSelectFileApplication();

  const bytes = hexToBytes('9071000005' + keyNo + '0300000000');
  const Result = await Ntag424.sendAPDUCommand(bytes);
  console.warn('Result: ', bytesToHex([Result.sw1, Result.sw2]));
  const resultData = bytesToHex(Result.response);
  //91AF is the successful code
  const resultCode = bytesToHex([Result.sw1, Result.sw2]);
  if (resultCode == '91af') {
    const key = CryptoJS.enc.Hex.parse(pKey);
    const iv = CryptoJS.enc.Hex.parse('00000000000000000000000000000000');
    const aesEncryptOption = {
      padding: CryptoJS.pad.NoPadding,
      mode: CryptoJS.mode.CBC,
      iv: iv,
      keySize: 128 / 8,
    };
    const RndBDec = AES.decrypt(
      {ciphertext: CryptoJS.enc.Hex.parse(resultData)},
      key,
      aesEncryptOption,
    );
    const RndB = CryptoJS.enc.Hex.stringify(RndBDec);
    const RndABytes = randomBytes(16);
    const RndA = bytesToHex(RndABytes);
    const RndBRotlBytes = leftRotate(hexToBytes(RndB));
    const RndBRotl = bytesToHex(RndBRotlBytes);

    const RndARndBRotl = RndA + RndBRotl;
    const RndARndBEncData = AES.encrypt(
      CryptoJS.enc.Hex.parse(RndARndBRotl),
      key,
      aesEncryptOption,
    );
    const RndARndBEnc = RndARndBEncData.ciphertext.toString(CryptoJS.enc.Hex);

    const secondAuthBytes = hexToBytes('90AF000020' + RndARndBEnc + '00');
    const secondAuthRes = await Ntag424.sendAPDUCommand(secondAuthBytes);
    console.warn(
      'Result: ',
      bytesToHex([secondAuthRes.sw1, secondAuthRes.sw2]),
    );
    //9100 is the successful code
    const secondAuthResultCode = bytesToHex([
      secondAuthRes.sw1,
      secondAuthRes.sw2,
    ]);
    if (secondAuthResultCode == '9100') {
      //auth successful
      const secondAuthResultData = bytesToHex(secondAuthRes.response);
      const secondAuthResultDataDec = AES.decrypt(
        {ciphertext: CryptoJS.enc.Hex.parse(secondAuthResultData)},
        key,
        aesEncryptOption,
      );
      const secondAuthResultDataDecStr = CryptoJS.enc.Hex.stringify(
        secondAuthResultDataDec,
      );

      const tiBytes = hexToBytes(secondAuthResultDataDecStr).slice(0, 4);
      const ti = bytesToHex(tiBytes);

      var WordArray = CryptoJS.lib.WordArray;
      const xor = CryptoJS.ext.xor(
        new WordArray.init(hexToBytes(RndA.slice(4, 16))),
        new WordArray.init(hexToBytes(RndB.slice(0, 12))),
      );
      let svPost = RndA.slice(0, 4);
      svPost += bytesToHex(xor.words);
      svPost += RndB.slice(12, 32) + RndA.slice(16, 32);
      //SV1 = A5h||5Ah||00h||01h||00h||80h||RndA[15..14]|| ( RndA[13..8] # RndB[15..10])||RndB[9..0]||RndA[7..0]
      let sv1 = 'A55A00010080';
      sv1 += svPost;
      const sesAuthEnc = CryptoJS.CMAC(key, CryptoJS.enc.Hex.parse(sv1));
      const sesAuthEncKey = sesAuthEnc.toString();

      //SV2 = 5Ah||A5h||00h||01h||00h||80h||RndA[15..14]|| ( RndA[13..8] # RndB[15..10])||RndB[9..0]||RndA[7..0]
      //# == XOR-operator

      let sv2 = '5AA500010080';
      sv2 += svPost;
      const sesAuthMac = CryptoJS.CMAC(key, CryptoJS.enc.Hex.parse(sv2));
      const sesAuthMacKey = sesAuthMac.toString();

      Ntag424.ti = ti;
      Ntag424.sesAuthMacKey = sesAuthMacKey;
      Ntag424.sesAuthEncKey = sesAuthEncKey;
      Ntag424.cmdCtrDec = 0;
      
      return Promise.resolve({sesAuthEncKey, sesAuthMacKey, ti});
    } else {
      //auth failed
      return Promise.reject('Auth Failed: ' + secondAuthResultCode);
    }
  } else {
    //auth failed
    return Promise.reject('Auth Failed: ' + resultCode);
  }
};

/**
 * AuthEv2NonFirst
 * CommMode N/A
 * @param {string} keyNo key number in hex (1 byte)
 * @param {string} pKey key value in hex (16 bytes)
 * @returns 
 */
Ntag424.AuthEv2NonFirst = async (keyNo, pKey) => {
  const bytes = hexToBytes('9077000001' + keyNo + '00');
  const Result = await Ntag424.sendAPDUCommand(bytes);
  console.warn(
    'auth ev2 non first part 1 Result: ',
    bytesToHex([Result.sw1, Result.sw2]),
  );
  const resultData = bytesToHex(Result.response);
  //91AF is the successful code
  const resultCode = bytesToHex([Result.sw1, Result.sw2]);
  if (resultCode == '91af') {
    const key = CryptoJS.enc.Hex.parse(pKey);
    const iv = CryptoJS.enc.Hex.parse('00000000000000000000000000000000');
    const aesEncryptOption = {
      padding: CryptoJS.pad.NoPadding,
      mode: CryptoJS.mode.CBC,
      iv: iv,
      keySize: 128 / 8,
    };
    const RndBDec = AES.decrypt(
      {ciphertext: CryptoJS.enc.Hex.parse(resultData)},
      key,
      aesEncryptOption,
    );
    const RndB = CryptoJS.enc.Hex.stringify(RndBDec);
    const RndABytes = randomBytes(16);
    const RndA = bytesToHex(RndABytes);
    const RndBRotlBytes = leftRotate(hexToBytes(RndB));
    const RndBRotl = bytesToHex(RndBRotlBytes);

    const RndARndBRotl = RndA + RndBRotl;
    const RndARndBEncData = AES.encrypt(
      CryptoJS.enc.Hex.parse(RndARndBRotl),
      key,
      aesEncryptOption,
    );
    const RndARndBEnc = RndARndBEncData.ciphertext.toString(CryptoJS.enc.Hex);

    const secondAuthBytes = hexToBytes('90AF000020' + RndARndBEnc + '00');
    const secondAuthRes = await Ntag424.sendAPDUCommand(secondAuthBytes);
    console.warn(
      'auth ev2 non first part 2 Result: ',
      bytesToHex([secondAuthRes.sw1, secondAuthRes.sw2]),
    );
    //9100 is the successful code
    const secondAuthResultCode = bytesToHex([
      secondAuthRes.sw1,
      secondAuthRes.sw2,
    ]);
    if (secondAuthResultCode == '9100') {
      //auth successful
      return Promise.resolve('Successful');
    } else {
      //auth failed
      return Promise.reject('Auth Failed: ' + secondAuthResultCode);
    }
  } else {
    //auth failed
    return Promise.reject('Auth Failed: ' + resultCode);
  }
};

/**
 * MACs the data and returns as a hex string
 * 
 * @param {byte[]} commandData data to MAC
 * @returns 
 */
Ntag424.calcMac = function (commandData) {

  const commandMac = CryptoJS.CMAC(
    CryptoJS.enc.Hex.parse(Ntag424.sesAuthMacKey),
    CryptoJS.enc.Hex.parse(commandData),
  );
  const commandMacHex = commandMac.toString();

  const truncatedMacBytes = hexToBytes(commandMacHex).filter(function (
    element,
    index,
    array,
  ) {
    return (index + 1) % 2 === 0;
  });
  return bytesToHex(truncatedMacBytes);
}

/**
 * Encrypts the data for CommMode.FULL
 * @param {string} cmdDataPadd Hex string of command data padded.
 * @param {byte[]} cmdCtr 
 * @returns 
 */
Ntag424.encData = function (cmdDataPadd, cmdCtr) {
  const iv = ivEncryption(Ntag424.ti, cmdCtr, Ntag424.sesAuthEncKey);
  const aesEncryptOption = {
    mode: CryptoJS.mode.CBC,
    iv: CryptoJS.enc.Hex.parse(iv),
    keySize: 128 / 8,
    padding: CryptoJS.pad.NoPadding,
  };

  return AES.encrypt(
    CryptoJS.enc.Hex.parse(cmdDataPadd),
    CryptoJS.enc.Hex.parse(Ntag424.sesAuthEncKey),
    aesEncryptOption,
  ).ciphertext.toString(CryptoJS.enc.Hex);
}

/**
 * Change File Settings
 * CommMode Full
 * 
 * @param {int} piccOffset picc offset
 * @param {int} macOffset mac offset
 * @returns 
 */
Ntag424.changeFileSettings = async (
  piccOffset,
  macOffset,
) => {
  const cmdHeader = '905F0000';
  //File Option SDM and mirroring enabled, CommMode: plain
  var cmdData = '40';
  //Access rights (FileAR.ReadWrite: 0x0, FileAR.Change: 0x0, FileAR.Read: 0xE, FileAR.Write; 0x0)
  cmdData += '00E0';
  //UID mirror: 1
  //SDMReadCtr: 1
  //SDMReadCtrLimit: 0
  //SDMENCFileData: 0
  //ASCII Encoding mode: 1
  cmdData += 'C1';
  //sdm access rights
  //RFU: 0F
  //CtrRet: 0F
  //MetaRead: 01
  //FileRead: 02
  cmdData += 'FF12';
  //ENCPICCDataOffset
  cmdData += piccOffset.toString(16).padEnd(6, '0');
  //SDMMACOffset
  cmdData += macOffset.toString(16).padEnd(6, '0');
  //SDMMACInputOffset
  cmdData += macOffset.toString(16).padEnd(6, '0');
  const fileNo = '02';
  console.log('cmdData', cmdData);

  const cmdDataPadd = padForEnc(cmdData, 16);

  const cmdCtr = decToHexLsbFirst(Ntag424.cmdCtrDec++, 2);
  
  const encKeyData = Ntag424.encData(cmdDataPadd, cmdCtr);

  const commandData = '5F' + cmdCtr + Ntag424.ti + fileNo + encKeyData;
  
  const truncatedMac = Ntag424.calcMac(commandData)

  const data = encKeyData + truncatedMac;
  const lc = (data.length / 2 + 1).toString(16);
  const changeFileSettingsHex = cmdHeader + lc + fileNo + encKeyData + truncatedMac + '00';

  const changeFileSettingsRes = await Ntag424.sendAPDUCommand(
    hexToBytes(changeFileSettingsHex),
  );
  const resCode = bytesToHex([
    changeFileSettingsRes.sw1,
    changeFileSettingsRes.sw2,
  ]);
  console.warn('changeFileSettingsRes Result: ', resCode);
  if (resCode == '9100') {
    return Promise.resolve('Successful');
  } else {
    const errorCodes = new Object();
    errorCodes['91ca'] = 'COMMAND_ABORTED chained command or multiple pass command ongoing.';
    errorCodes['911e'] = 'INTEGRITY_ERROR Integrity error in cryptogram. Invalid Secure Messaging MAC (only).';
    errorCodes['917e'] = 'LENGTH_ERROR Command size not allowed.';
    errorCodes['919e'] = 'PARAMETER_ERROR Parameter value not allowed';
    errorCodes['919d'] = 'PERMISSION_DENIED PICC level (MF) is selected. access right Change of targeted file has access conditions set to Fh. Enabling Secure Dynamic Messaging (FileOption Bit 6 set to 1b) is only allowed for FileNo 02h.';
    errorCodes['91f0'] = 'FILE_NOT_FOUND F0h File with targeted FileNo does not exist for the targeted application. ';
    errorCodes['91ae'] = 'AUTHENTICATION_ERROR AEh File access right Change of targeted file not granted as there is no active authentication with the required key while the access conditions is different from Fh.';
    errorCodes['91ee'] = 'MEMORY_ERROR EEh Failure when reading or writing to non-volatile memory.';
    
    return Promise.reject('changeFileSettingsRes Failed, code ' +resCode + ' ' + errorCodes[resCode] );
  }
};

/**
 * Reset File Settings
 * CommMode full
 * @param {string} sesAuthEncKey hex string (16 bytes)
 * @param {string} sesAuthMacKey hex string (16 bytes)
 * @param {string} ti hex string ( 4bytes)
 * @param {int} cmdCtrDec command counter in int
 * @returns 
 */
Ntag424.resetFileSettings = async (
  sesAuthEncKey,
  sesAuthMacKey,
  ti,
  cmdCtrDec,
) => {
  //File Option SDM and mirroring enabled, CommMode: plain
  var cmdData = '40';
  //Access rights (FileAR.ReadWrite: 0xE, FileAR.Change: 0x0, FileAR.Read: 0xE, FileAR.Write; 0xE)
  cmdData += 'E0EE';

  //UID mirror: 0
  // SDMReadCtr: 0
  // SDMReadCtrLimit: 0
  // SDMENCFileData: 0
  // ASCII Encoding mode: 1
  cmdData += '01';
  //sdm access rights
  //RFU: 0F
  //CtrRet: 0F
  //MetaRead: 0F
  //FileRead: 0F
  cmdData += 'FFFF';
  //no picc offset and mac offset

  const cmdDataPadd = padForEnc(cmdData, 16);
  const cmdCtr = decToHexLsbFirst(Ntag424.cmdCtrDec++, 2);
  const iv = ivEncryption(ti, cmdCtr, sesAuthEncKey);
  const aesEncryptOption = {
    mode: CryptoJS.mode.CBC,
    iv: CryptoJS.enc.Hex.parse(iv),
    keySize: 128 / 8,
    padding: CryptoJS.pad.NoPadding,
  };

  const encKeyData = AES.encrypt(
    CryptoJS.enc.Hex.parse(cmdDataPadd),
    CryptoJS.enc.Hex.parse(sesAuthEncKey),
    aesEncryptOption,
  ).ciphertext.toString(CryptoJS.enc.Hex);

  const fileNo = '02';
  const commandMac = CryptoJS.CMAC(
    CryptoJS.enc.Hex.parse(sesAuthMacKey),
    CryptoJS.enc.Hex.parse('5F' + cmdCtr + ti + fileNo + encKeyData),
  );
  const commandMacHex = commandMac.toString();

  const truncatedMacBytes = hexToBytes(commandMacHex).filter(function (
    element,
    index,
    array,
  ) {
    return (index + 1) % 2 === 0;
  });
  const truncatedMac = bytesToHex(truncatedMacBytes);
  const data = encKeyData + truncatedMac;
  const lc = (data.length / 2 + 1).toString(16);
  const changeFileSettingsHex =
    '905F0000' + lc + fileNo + encKeyData + truncatedMac + '00';

  const changeFileSettingsRes = await Ntag424.sendAPDUCommand(
    hexToBytes(changeFileSettingsHex),
  );
  const resCode = bytesToHex([
    changeFileSettingsRes.sw1,
    changeFileSettingsRes.sw2,
  ]);
  console.warn('changeFileSettingsRes Result: ', resCode);
  if (resCode == '9100') {
    const message = [Ndef.uriRecord('')];
    const bytes = Ndef.encodeMessage(message);
    await NfcManager.ndefHandler.writeNdefMessage(bytes);

    return Promise.resolve('Successful');
  } else {
    return Promise.reject(resCode);
  }
};

/**
 * Change Key
 * CommMode full
 * 
 * @param {string} sesAuthEncKey hex string (16 bytes)
 * @param {string} sesAuthMacKey hex string (16 bytes)
 * @param {string} ti hex string ( 4bytes)
 * @param {int} cmdCtrDec command counter in int
 * @param {string} keyNo key number in hex (1 byte)
 * @param {string} key old key value in hex (16 bytes)
 * @param {string} newKey new key value in hex (16 bytes)
 * @param {string} keyVersion new key version in hex (1 byte)
 * @returns 
 */
Ntag424.changeKey = async (
  sesAuthEncKey,
  sesAuthMacKey,
  ti,
  cmdCtrDec,
  keyNo,
  key,
  newKey,
  keyVersion,
) => {
  const cmdCtr = decToHexLsbFirst(Ntag424.cmdCtrDec++, 2);
  const iv = ivEncryption(ti, cmdCtr, sesAuthEncKey);
  const aesEncryptOption = {
    mode: CryptoJS.mode.CBC,
    iv: CryptoJS.enc.Hex.parse(iv),
    keySize: 128 / 8,
    padding: CryptoJS.pad.NoPadding,
  };

  var keyData = '';
  const newKeyBytes = hexToBytes(newKey);
  if (keyNo == '00') {
    //if key 0 is to be changed
    //keyData = NewKey || KeyVer 17 byte
    // 0000000000000000000000000000
    // 0000000000000000000000000000
    keyData = padForEnc(newKey + keyVersion, 32); //32 byte
  } else {
    //if key 1 to 4 are to be changed
    //keyData = (NewKey XOR OldKey) || KeyVer || CRC32NK
    // crc32
    var WordArray = CryptoJS.lib.WordArray;

    const oldNewXorBytes = CryptoJS.ext.xor(
      new WordArray.init(hexToBytes(key)),
      new WordArray.init(newKeyBytes),
    ).words;
    const oldNewXor = bytesToHex(oldNewXorBytes);
    const crc32Reversed = crc.crcjam(newKeyBytes).toString(16);
    const crc32 = bytesToHex(hexToBytes(crc32Reversed).reverse());
    keyData = padForEnc(oldNewXor + keyVersion + crc32, 32); //32 bytes
  }

  const encKeyData = AES.encrypt(
    CryptoJS.enc.Hex.parse(keyData),
    CryptoJS.enc.Hex.parse(sesAuthEncKey),
    aesEncryptOption,
  ).ciphertext.toString(CryptoJS.enc.Hex);

  const commandMac = CryptoJS.CMAC(
    CryptoJS.enc.Hex.parse(sesAuthMacKey),
    CryptoJS.enc.Hex.parse('C4' + cmdCtr + ti + keyNo + encKeyData),
  );
  const commandMacHex = commandMac.toString();

  const truncatedMacBytes = hexToBytes(commandMacHex).filter(function (
    element,
    index,
    array,
  ) {
    return (index + 1) % 2 === 0;
  });
  const truncatedMac = bytesToHex(truncatedMacBytes);
  const data = encKeyData + truncatedMac;
  const lc = (data.length / 2 + 1).toString(16);
  const changeKeyHex =
    '90C40000' + lc + keyNo + encKeyData + truncatedMac + '00';

  const changeKeyRes = await Ntag424.sendAPDUCommand(hexToBytes(changeKeyHex));

  const resCode = bytesToHex([changeKeyRes.sw1, changeKeyRes.sw2]);
  console.warn('changeKeyRes Result: ', resCode);
  if (resCode == '9100') {
    return Promise.resolve('Successful');
  } else {
    return Promise.reject(resCode);
  }
};

/**
 * Get Card UID
 * CommMode Full
 * 
 * @param {string} sesAuthEncKey hex string (16 bytes)
 * @param {string} sesAuthMacKey hex string (16 bytes)
 * @param {string} ti hex string ( 4bytes)
 * @param {int} cmdCtrDec command counter in int
 * @returns 
 */
Ntag424.getCardUid = async (sesAuthEncKey, sesAuthMacKey, ti, cmdCtrDec) => {
  var cmdCtr = decToHexLsbFirst(Ntag424.cmdCtrDec++, 2);
  const commandMac = CryptoJS.CMAC(
    CryptoJS.enc.Hex.parse(sesAuthMacKey),
    CryptoJS.enc.Hex.parse('51' + cmdCtr + ti),
  );
  const commandMacHex = commandMac.toString();

  const truncatedMacBytes = hexToBytes(commandMacHex).filter(function (
    element,
    index,
    array,
  ) {
    return (index + 1) % 2 === 0;
  });
  const truncatedMac = bytesToHex(truncatedMacBytes);

  const getCardUidBytes = hexToBytes('9051000008' + truncatedMac + '00');
  const getCardUidRes = await Ntag424.sendAPDUCommand(getCardUidBytes);

  const responseAPDU = bytesToHex(getCardUidRes.response);
  const resCode = bytesToHex([getCardUidRes.sw1, getCardUidRes.sw2]);

  const resMacT = responseAPDU.slice(-16);
  cmdCtrDec += 1;
  cmdCtr = decToHexLsbFirst(cmdCtrDec, 2);

  const iv = ivEncryptionResponse(ti, cmdCtr, sesAuthEncKey);

  // console.log('test iv ', ivEncryption("2B4D963C014DC36F24F69A50A394F875"))
  const resDataEnc = responseAPDU.slice(0, -16);

  const resDataDec = AES.decrypt(
    {ciphertext: CryptoJS.enc.Hex.parse(resDataEnc)},
    CryptoJS.enc.Hex.parse(sesAuthEncKey),
    {
      padding: CryptoJS.pad.NoPadding,
      mode: CryptoJS.mode.CBC,
      iv: CryptoJS.enc.Hex.parse(iv),
      keySize: 128 / 8,
    },
  );
  const resData = CryptoJS.enc.Hex.stringify(resDataDec);
  const uid = resData.slice(0, 14);

  if (resCode == '9100') {
    return Promise.resolve(uid);
  } else {
    return Promise.reject(resCode);
  }
};

export default Ntag424;
