import { useEffect, useRef, useState } from 'react';
import { interpretVoiceCommand } from '../../integrations/voiceflow';
import type { JerseyItem } from '../../types';

interface Props {
  rows: JerseyItem[];
  onAction: (intent: any) => void | Promise<void>;
}

export function VoiceMic({ rows, onAction }: Props) {
  const recRef = useRef<SpeechRecognition | null>(null);
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      return;
    }
    const rec: SpeechRecognition = new SR();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = async (e: SpeechRecognitionEvent) => {
      const transcript = e.results[0][0].transcript;
      const intent = await interpretVoiceCommand(transcript);
      await onAction(intent);
      setListening(false);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
  }, [onAction]);

  if (!supported) return null;

  return (
    <button
      className={`rounded px-3 py-2 ${listening ? 'bg-red-600 text-white' : 'border'}`}
      onClick={() => {
        if (!recRef.current) return;
        if (!listening) {
          setListening(true);
          recRef.current.start();
        } else {
          recRef.current.stop();
          setListening(false);
        }
      }}
    >
      {listening ? 'Listening…' : '🎤 Voice'}
    </button>
  );
}


