import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, RefreshCw, XCircle, Play, CheckCircle, AlertCircle, ScanEye } from 'lucide-react';
import { AppState, RepairPlan, ComponentInfo } from './types';
import { analyzeImageAndCreatePlan, verifyRepairStep, askRepairAssistant, identifyComponentAtPoint } from './services/geminiService';
import OverlayCanvas from './components/OverlayCanvas';
import { ThinkingIndicator } from './components/ThinkingIndicator';
import StepCard from './components/StepCard';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.INTRO);
  const [repairPlan, setRepairPlan] = useState<RepairPlan | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null); // To show frozen frame for AR stability
  
  // Assistant State
  const [isListening, setIsListening] = useState(false);
  const [assistantResponse, setAssistantResponse] = useState<string | null>(null);

  // Inspector State
  const [inspectorPoint, setInspectorPoint] = useState<{x: number, y: number} | null>(null);
  const [componentInfo, setComponentInfo] = useState<ComponentInfo | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Initialize Camera
  const startCamera = async () => {
    try {
      setAppState(AppState.CAMERA_READY);
      setCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true // Request audio for assistant
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      setErrorMsg("Camera/Mic access denied. Please enable permissions.");
      setAppState(AppState.ERROR);
    }
  };

  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Match canvas to video dimensions
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // Get base64 without prefix for API
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const base64 = dataUrl.split(',')[1];
    return base64;
  }, []);

  const handleScan = async () => {
    const base64 = captureFrame();
    if (!base64) return;

    // Freeze frame UI by setting background to captured image
    setCapturedImage(`data:image/jpeg;base64,${base64}`);
    setAppState(AppState.ANALYZING);

    try {
      const plan = await analyzeImageAndCreatePlan(base64);
      setRepairPlan(plan);
      setCurrentStepIndex(0);
      setAppState(AppState.REPAIR_GUIDE);
    } catch (err) {
      console.error(err);
      setErrorMsg("Gemini could not identify the issue. Please try again with better lighting.");
      setAppState(AppState.ERROR);
    }
  };

  const handleVerifyStep = async () => {
    setCapturedImage(null); 
    setAppState(AppState.VERIFYING);
    
    setTimeout(async () => {
        const base64 = captureFrame();
        if (!base64) {
             setAppState(AppState.REPAIR_GUIDE);
             return; 
        }

        if (repairPlan) {
            const currentStep = repairPlan.steps[currentStepIndex];
            const result = await verifyRepairStep(base64, currentStep.instruction);
            
            if (result.completed) {
                handleNextStep();
            } else {
                // alert(`Not quite done: ${result.feedback}`); // Better to show as assistant msg
                setAssistantResponse(`Verification Info: ${result.feedback}`);
                speak(result.feedback);
                setAppState(AppState.REPAIR_GUIDE);
                setCapturedImage(`data:image/jpeg;base64,${base64}`); 
            }
        }
    }, 1500);
  };

  const handleNextStep = () => {
    setAssistantResponse(null); // Clear previous advice
    if (!repairPlan) return;
    
    if (currentStepIndex < repairPlan.steps.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
      setCapturedImage(null);
      setAppState(AppState.REPAIR_GUIDE);
    } else {
      setAppState(AppState.COMPLETED);
    }
  };

  // --- Inspector Logic ---
  const handleVideoClick = async (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
      // Only active in REPAIR_GUIDE mode to avoid conflicts, or maybe toggle mode
      if (appState !== AppState.REPAIR_GUIDE || !repairPlan) return;
      
      // Determine coordinates
      let clientX, clientY;
      if ('touches' in e) {
          clientX = e.touches[0].clientX;
          clientY = e.touches[0].clientY;
      } else {
          clientX = (e as React.MouseEvent).clientX;
          clientY = (e as React.MouseEvent).clientY;
      }

      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      
      // Percentage coordinates 0-100
      const xPct = (x / rect.width) * 100;
      const yPct = (y / rect.height) * 100;

      setInspectorPoint({ x: xPct, y: yPct });
      setAppState(AppState.INSPECTING);
      
      // Capture and analyze
      const base64 = captureFrame();
      if (!base64) {
          setAppState(AppState.REPAIR_GUIDE);
          return;
      }

      // Freeze for inspection
      setCapturedImage(`data:image/jpeg;base64,${base64}`);

      const info = await identifyComponentAtPoint(base64, xPct, yPct, repairPlan.objectName);
      setComponentInfo(info);
      speak(`That is the ${info.name}.`);
  };

  const closeInspector = () => {
      setInspectorPoint(null);
      setComponentInfo(null);
      setCapturedImage(null);
      setAppState(AppState.REPAIR_GUIDE);
  };

  // --- Assistant Logic ---

  const startListening = () => {
    setAssistantResponse("Listening...");
    setIsListening(true);
    
    if (!videoRef.current || !videoRef.current.srcObject) return;
    const stream = videoRef.current.srcObject as MediaStream;
    
    // Create recorder from existing stream's audio track
    const audioTrack = stream.getAudioTracks()[0];
    if(!audioTrack) return;
    
    const audioStream = new MediaStream([audioTrack]);
    const recorder = new MediaRecorder(audioStream);
    mediaRecorderRef.current = recorder;
    audioChunksRef.current = [];

    recorder.ondataavailable = (event) => {
      audioChunksRef.current.push(event.data);
    };

    recorder.start();
  };

  const stopListening = async () => {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    setIsListening(false);
    setAssistantResponse("Thinking...");

    mediaRecorderRef.current.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' }); // Default to webm/wav
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64AudioWithPrefix = reader.result as string;
        const base64Audio = base64AudioWithPrefix.split(',')[1];
        
        // Grab context image
        const base64Image = captureFrame();
        if (base64Image && repairPlan) {
            const response = await askRepairAssistant(
                base64Image, 
                base64Audio, 
                repairPlan.steps[currentStepIndex].instruction
            );
            setAssistantResponse(response);
            speak(response);
        }
      };
    };
  };

  const speak = (text: string) => {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.1;
        utterance.pitch = 1.0;
        window.speechSynthesis.speak(utterance);
    }
  };

  const resetApp = () => {
    setRepairPlan(null);
    setCurrentStepIndex(0);
    setCapturedImage(null);
    setErrorMsg(null);
    setAssistantResponse(null);
    setAppState(AppState.CAMERA_READY);
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden flex flex-col">
      
      {/* Hidden Canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Camera Feed Container */}
      <div 
        ref={containerRef} 
        className="relative w-full h-full flex items-center justify-center bg-gray-900"
        onClick={handleVideoClick} // Enable tap to inspect
      >
        <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted={true} 
            onLoadedMetadata={() => videoRef.current?.play()}
            className={`absolute min-w-full min-h-full object-cover ${capturedImage ? 'opacity-0' : 'opacity-100'}`}
        />
        
        {/* Frozen Frame */}
        {capturedImage && (
            <img 
                src={capturedImage} 
                className="absolute w-full h-full object-cover z-10" 
                alt="Analyzed Frame" 
            />
        )}

        {/* AR Overlay Layer */}
        {appState === AppState.REPAIR_GUIDE && repairPlan && videoRef.current && (
           <div className="absolute top-0 left-0 w-full h-full z-20 pointer-events-none">
               <OverlayCanvas 
                 cue={repairPlan.steps[currentStepIndex].visualCue}
                 width={containerRef.current?.clientWidth || 300}
                 height={containerRef.current?.clientHeight || 600}
               />
               
               {/* Inspector Hint */}
               <div className="absolute top-4 right-4 bg-black/40 backdrop-blur text-white/70 text-[10px] px-2 py-1 rounded-full border border-white/10 flex items-center gap-1 animate-pulse">
                   <ScanEye size={12} />
                   Tap any part to inspect
               </div>
           </div>
        )}

        {/* Inspector Reticle & Card */}
        {appState === AppState.INSPECTING && inspectorPoint && (
            <div className="absolute inset-0 z-30 pointer-events-none">
                {/* Target Reticle */}
                <div 
                    className="absolute w-12 h-12 border-2 border-cyan-400 rounded-full -ml-6 -mt-6 animate-ping opacity-75"
                    style={{ left: `${inspectorPoint.x}%`, top: `${inspectorPoint.y}%` }}
                />
                <div 
                    className="absolute w-4 h-4 bg-cyan-400 rounded-full -ml-2 -mt-2 shadow-[0_0_10px_#22d3ee]"
                    style={{ left: `${inspectorPoint.x}%`, top: `${inspectorPoint.y}%` }}
                />

                {/* Info Card - Centered or near point */}
                {componentInfo ? (
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 pointer-events-auto">
                        <div className="bg-gray-900/95 border border-cyan-500/50 rounded-xl p-4 shadow-[0_0_50px_rgba(6,182,212,0.3)] backdrop-blur-xl">
                            <div className="flex justify-between items-start mb-2">
                                <h3 className="text-xl font-bold text-cyan-400">{componentInfo.name}</h3>
                                <div className={`text-xs px-2 py-0.5 rounded uppercase font-bold ${
                                    componentInfo.status === 'Good' ? 'bg-green-900 text-green-400' :
                                    componentInfo.status === 'Damaged' ? 'bg-red-900 text-red-400' :
                                    'bg-gray-700 text-gray-300'
                                }`}>
                                    {componentInfo.status}
                                </div>
                            </div>
                            <p className="text-gray-300 text-sm mb-3 font-light">{componentInfo.function}</p>
                            <div className="text-xs text-cyan-100/70 bg-cyan-950/30 p-2 rounded border border-cyan-900/50 mb-4">
                                <strong>Analysis:</strong> {componentInfo.details}
                            </div>
                            <button 
                                onClick={(e) => { e.stopPropagation(); closeInspector(); }}
                                className="w-full py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white font-medium transition-colors"
                            >
                                Resume Repair
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-auto">
                        <div className="bg-black/80 backdrop-blur px-6 py-4 rounded-xl flex flex-col items-center gap-3">
                            <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                            <span className="text-cyan-400 font-mono text-sm tracking-widest">IDENTIFYING COMPONENT...</span>
                        </div>
                    </div>
                )}
            </div>
        )}
      </div>

      {/* Intro Screen */}
      {appState === AppState.INTRO && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-gray-900 to-black p-6 text-center">
            <div className="w-20 h-20 bg-cyan-500 rounded-2xl flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(6,182,212,0.5)]">
                <WrenchIcon />
            </div>
            <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600 mb-4">
                Omni-Fix
            </h1>
            <p className="text-gray-400 mb-8 max-w-xs">
                AI-Powered AR Repair Manual. <br/> Now with Sonic Assistant.
            </p>
            <button 
                onClick={startCamera}
                className="px-8 py-4 bg-cyan-600 rounded-full font-bold text-lg hover:bg-cyan-500 transition-all shadow-lg shadow-cyan-900/40 flex items-center gap-2"
            >
                <Camera size={24} />
                Start Repair
            </button>
        </div>
      )}

      {/* Analyzing State */}
      {appState === AppState.ANALYZING && (
          <ThinkingIndicator message="DIAGNOSING & PLANNING..." />
      )}

      {/* Verifying State */}
      {appState === AppState.VERIFYING && (
          <ThinkingIndicator message="VERIFYING REPAIR..." />
      )}

      {/* Scan Trigger */}
      {appState === AppState.CAMERA_READY && (
          <div className="absolute bottom-12 left-0 w-full flex justify-center z-40">
              <button 
                onClick={handleScan}
                className="w-20 h-20 rounded-full border-4 border-white/80 flex items-center justify-center bg-white/20 backdrop-blur-sm active:scale-95 transition-all"
              >
                  <div className="w-16 h-16 bg-white rounded-full animate-pulse"></div>
              </button>
              <div className="absolute top-[-50px] text-white/80 font-mono bg-black/50 px-3 py-1 rounded">
                  Point at broken object
              </div>
          </div>
      )}

      {/* Repair Guide Interface */}
      {(appState === AppState.REPAIR_GUIDE || appState === AppState.VERIFYING) && repairPlan && (
          <>
            <div className="absolute top-0 left-0 w-full p-4 bg-gradient-to-b from-black/80 to-transparent z-40 pointer-events-none">
                <div className="flex justify-between items-start pointer-events-auto">
                    <div>
                        <h2 className="text-xl font-bold text-white">{repairPlan.objectName}</h2>
                        <p className="text-red-400 text-sm font-medium flex items-center gap-1">
                            <AlertCircle size={14} />
                            {repairPlan.issueDiagnosis}
                        </p>
                    </div>
                    <button onClick={resetApp} className="p-2 bg-gray-800/50 rounded-full text-white/70 hover:text-white">
                        <XCircle size={24} />
                    </button>
                </div>
            </div>

            <StepCard 
                step={repairPlan.steps[currentStepIndex]}
                totalSteps={repairPlan.steps.length}
                currentStepIndex={currentStepIndex}
                onVerify={handleVerifyStep}
                onNext={handleNextStep}
                isVerifying={appState === AppState.VERIFYING}
                onAskAssistantStart={startListening}
                onAskAssistantStop={stopListening}
                isListening={isListening}
                assistantResponse={assistantResponse}
            />
          </>
      )}

        {/* Completion Screen */}
        {appState === AppState.COMPLETED && (
             <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/95 text-center p-6">
                 <CheckCircle size={80} className="text-green-500 mb-6" />
                 <h2 className="text-3xl font-bold text-white mb-2">Repair Complete!</h2>
                 <p className="text-gray-400 mb-8">You've successfully fixed the issue.</p>
                 <button 
                    onClick={resetApp}
                    className="px-6 py-3 bg-gray-800 border border-gray-600 rounded-lg text-white hover:bg-gray-700 flex items-center gap-2"
                 >
                     <RefreshCw size={20} />
                     Fix Something Else
                 </button>
             </div>
        )}

      {/* Error State */}
      {appState === AppState.ERROR && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/90 text-center p-6">
            <XCircle size={60} className="text-red-500 mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">System Error</h3>
            <p className="text-gray-400 mb-6">{errorMsg || "An unknown error occurred."}</p>
            <button 
                onClick={resetApp}
                className="px-6 py-3 bg-red-600 rounded-lg text-white font-medium hover:bg-red-500"
            >
                Try Again
            </button>
        </div>
      )}

    </div>
  );
};

const WrenchIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    </svg>
);

export default App;