# Questions

Does the model matter?

Q: Yes, base and enhanced models are legacy. Use Nova 2 or Nova 3.

A: it depends on languages, check language availability.

Nova 3 is recommended for multiple speakers. It is built for handling complex audio scenarios with high accuracy.

If you're using multiple languages, make sure to choose a model that supports all the languages you need.

Q: Should I always use the same model for both development and production?

Q: I'm assuming different models are priced differently depending on their capabilities and performance, is that correct or is pricing based on features used?

A: Different models are priced differently depending on their capabilities and performance.

Q: Does deepgram provide the audio ingest services as part of the api? or do I need to handle that separately? The code example uses ffmpeg to process third party audio so that threw me off.

A: No, the system will take the live audio in chunks.

Q: In diarization, what's the difference between latest (v1) and plain v1?

A: Live Streaming don't have a v2 diarization model. But precorded audio upload does.

The "latest (v1)" is the best choice for most live streaming scenarios, offering improved speaker separation and accuracy compared to the "plain v1" model.
