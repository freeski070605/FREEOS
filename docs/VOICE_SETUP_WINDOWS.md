# Voice Setup on Windows

Phase 4 works without paid APIs. FREEOS can record and save push-to-talk audio even when STT is not installed. Its dashboard also provides typed local-Ollama chat, local speech output, engine status, and recent sessions. Missing optional engines produce setup-needed messages; they do not prevent startup.

## Configure the defaults

Copy `.env.example` to `.env`. Voice is enabled by default, recordings go to `data/voice/recordings`, generated WAV files to `data/voice/output`, STT defaults to `whispercpp`, and TTS defaults to `windows`.

```powershell
npm run init:voice
npm run check:voice
```

## Windows TTS fallback

Set `VOICE_TTS_ENGINE=windows`. FREEOS uses the built-in .NET `System.Speech` synthesizer through local PowerShell and writes a WAV. No voice download or API key is needed. Run `npm run check:voice`, start FREEOS, enter text in **Speak text locally**, and click **Speak locally**.

## whisper.cpp STT

FREEOS keeps the official source and local models under `services/whispercpp`. Create the folders, clone, and build the CPU CLI:

```powershell
npm run setup:whisper-folders
Set-Location services\whispercpp
git clone https://github.com/ggml-org/whisper.cpp.git source
Set-Location source
cmake -B build
cmake --build build --config Release --target whisper-cli
```

Download `ggml-small.en.bin` from the official [whisper.cpp model repository](https://huggingface.co/ggerganov/whisper.cpp/tree/main) into `services/whispercpp/models`. Then set:

```dotenv
VOICE_STT_ENGINE=whispercpp
WHISPER_CPP_PATH=F:\FREEOS\services\whispercpp\source\build\bin\Release\whisper-cli.exe
WHISPER_MODEL_PATH=F:\FREEOS\services\whispercpp\models\ggml-small.en.bin
WHISPER_MODEL_FAST_PATH=F:\FREEOS\services\whispercpp\models\ggml-small.en.bin
WHISPER_MODEL_BALANCED_PATH=F:\FREEOS\services\whispercpp\models\ggml-medium.en.bin
WHISPER_MODEL_QUALITY_PATH=F:\FREEOS\services\whispercpp\models\ggml-large-v3-turbo.bin
FFMPEG_PATH=ffmpeg
```

`WHISPER_CPP_PATH` is the local CLI executable; `WHISPER_MODEL_PATH` is the active model. The profile paths reserve fast, balanced, and quality choices for later UI support. FREEOS uses local FFmpeg to normalize browser recordings to 16 kHz mono, 16-bit PCM WAV before transcription.

## Piper TTS

Install Piper and a local voice model, then set:

```dotenv
VOICE_TTS_ENGINE=piper
PIPER_PATH=C:\path\to\piper.exe
PIPER_MODEL_PATH=C:\path\to\voice.onnx
PIPER_VOICE_NAME=optional-friendly-name
```

`PIPER_PATH` is the executable and `PIPER_MODEL_PATH` is the `.onnx` voice model. FREEOS sends text over stdin and writes output under `data/voice/output`.

## Microphone troubleshooting

- Open the dashboard from `http://127.0.0.1:5173` and click **Start recording**; FREEOS never requests access on page load.
- In the browser site-permission panel, allow microphone access for the dashboard origin.
- In Windows Settings, enable **Privacy & security → Microphone → Let desktop apps access your microphone**.
- If permission was denied previously, reset the site's microphone permission and reload.
- Recording can still be previewed and saved when STT reports setup needed.
