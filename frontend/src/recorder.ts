function downsample(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (targetRate === sourceRate) return input
  const ratio = sourceRate / targetRate
  const output = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < output.length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(Math.floor((i + 1) * ratio), input.length)
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    output[i] = sum / Math.max(end - start, 1)
  }
  return output
}

function toWav(chunks: Float32Array[], rate: number): Blob {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const samples = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length }
  const pcm = downsample(samples, rate, 16000)
  const buffer = new ArrayBuffer(44 + pcm.length * 2)
  const view = new DataView(buffer)
  const write = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)) }
  write(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); write(8, 'WAVE')
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data')
  view.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) {
    const sample = Math.max(-1, Math.min(1, pcm[i]))
    view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

export async function beginRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const processor = context.createScriptProcessor(4096, 1, 1)
  const silent = context.createGain()
  silent.gain.value = 0
  const chunks: Float32Array[] = []
  processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
  source.connect(processor); processor.connect(silent); silent.connect(context.destination)

  let finished = false
  return {
    stop: async () => {
      if (finished) return new Blob([], { type: 'audio/wav' })
      finished = true
      processor.disconnect(); source.disconnect(); silent.disconnect()
      stream.getTracks().forEach((track) => track.stop())
      await context.close()
      return toWav(chunks, context.sampleRate)
    },
  }
}
