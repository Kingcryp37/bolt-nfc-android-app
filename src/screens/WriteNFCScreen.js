import React, { useEffect, useState } from 'react';
import { NativeEventEmitter, NativeModules, StyleSheet, Text, TextInput, View } from 'react-native';

import { useFocusEffect } from '@react-navigation/native';

export default function WriteNFCScreen(props) {
    const [nodeURL, setNodeURL] = useState("")
    const [writeOutput, setWriteOutput] = useState("pending...")
  
    useEffect(() =>{
      const eventEmitter = new NativeEventEmitter(NativeModules.ToastExample);
      const eventListener = eventEmitter.addListener('WriteResult', (event) => {
        setWriteOutput(event.output)
      });
  
      return () => {
        eventListener.remove();
      };
    })
  
    const updateNodeUrl = text => {
      setNodeURL(text);
      NativeModules.MyReactModule.setNodeURL(text);
    }
  
    useFocusEffect(
      React.useCallback(() => {
        NativeModules.MyReactModule.setCardMode("write");
      }, [])
    );
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
         <Text>Please enter your node's domain and path</Text>
         <Text>For boltcard server be sure to add /ln to the end of the domain</Text>
          <View style={{flexDirection:'column'}}>
            <Text style={{textAlign:'center', marginTop:30}}>lnurlw://</Text>
            <TextInput 
              style={styles.input} 
              value={nodeURL} 
              multiline = {true}
              numberOfLines = {4}
              autoCapitalize='none'
              onChangeText={(text) => updateNodeUrl(text)}
              placeholder="yourboltcard.domain.com/ln"
            />
  
          </View>
          <Text>Then scan to write NFC card</Text>
          <Text style={{color: writeOutput == "success" ? 'green' : 'red'}}>{writeOutput}</Text>
          { writeOutput.indexOf("91AE") != -1 && <Text style={{color: writeOutput == "success" ? 'green' : 'red'}}>This card's write key may have been changed</Text>}
      </View>
    );
}
const styles = StyleSheet.create({
    input: {
      height: 160,
      margin: 12,
      borderWidth: 1,
      padding: 10,
      fontFamily: 'monospace',
      textAlignVertical: 'top'
    },
  });
  