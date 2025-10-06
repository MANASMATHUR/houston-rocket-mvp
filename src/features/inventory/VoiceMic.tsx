import { useEffect, useRef, useState } from 'react';
import { interpretVoiceCommand } from '../../integrations/voiceflow';
import type { VoiceCommandResult } from '../../integrations/voiceflow';
import type { JerseyItem } from '../../types';
import { Mic, MicOff, Volume2 } from 'lucide-react';

interface Props {
  rows: JerseyItem[];
  onAction: (intent: VoiceCommandResult) => void | Promise<void>;
}

export function VoiceMic({ rows: _rows, onAction }: Props) {
  const recRef = useRef<SpeechRecognition | null>(null);
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [transcript, setTranscript] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      return;
    }
    
    const rec: SpeechRecognition = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    
    rec.onstart = () => {
      setListening(true);
      setTranscript('');
    };
    
    rec.onresult = async (e: SpeechRecognitionEvent) => {
      const currentTranscript = e.results[0][0].transcript;
      setTranscript(currentTranscript);
      
      if (e.results[0].isFinal) {
        setIsProcessing(true);
        try {
          const intent = await interpretVoiceCommand(currentTranscript);
          await onAction(intent);
        } catch (error) {
          console.error('Voice command processing error:', error);
        } finally {
          setIsProcessing(false);
          setListening(false);
          setTranscript('');
        }
      }
    };
    
    rec.onend = () => {
      setListening(false);
      setTranscript('');
    };
    
    rec.onerror = (event: any) => {
      console.error('Speech recognition error:', (event && event.error) || event);
      setListening(false);
      setTranscript('');
      setIsProcessing(false);
    };
    
    recRef.current = rec;
  }, [onAction]);

  const startListening = () => {
    if (!recRef.current || listening) return;
    
    try {
      recRef.current.start();
    } catch (error) {
      console.error('Failed to start speech recognition:', error);
    }
  };

  const stopListening = () => {
    if (!recRef.current || !listening) return;
    
    try {
      recRef.current.stop();
    } catch (error) {
      console.error('Failed to stop speech recognition:', error);
    }
  };

  if (!supported) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Volume2 className="h-4 w-4" />
        <span>Voice not supported</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        className={`btn btn-sm ${
          listening 
            ? 'btn-error' 
            : isProcessing 
            ? 'btn-warning' 
            : 'btn-secondary'
        }`}
        onClick={listening ? stopListening : startListening}
        disabled={isProcessing}
      >
        {listening ? (
          <MicOff className="h-4 w-4" />
        ) : isProcessing ? (
          <div className="loading h-4 w-4" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
        <span className="hidden sm:inline">
          {listening ? 'Stop' : isProcessing ? 'Processing...' : 'Voice'}
        </span>
      </button>
      
      {transcript && (
        <div className="text-sm text-gray-600 max-w-48 truncate">
          "{transcript}"
        </div>
      )}
      
      <div className="text-xs text-gray-500 hidden md:block">
        Try: "Add 5 Jalen Green jerseys" or "Order 3 Icon jerseys size 48"
      </div>
    </div>
  );
}


