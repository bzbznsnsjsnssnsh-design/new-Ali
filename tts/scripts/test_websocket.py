#!/usr/bin/env python
"""
Test WebSocket connection to TTSFM server.

This script tests the WebSocket functionality by connecting to the server
and performing a simple TTS generation request.
"""

import time
import socketio

# Create a Socket.IO client
sio = socketio.Client(logger=True, engineio_logger=True)

# Track connection state
connected = False
stream_complete = False
chunks_received = 0


@sio.on('connect')
def on_connect():
    """Handle connection event."""
    global connected
    connected = True
    print('\n✅ Connected to WebSocket server!')
    print(f'Session ID: {sio.sid}')
    

@sio.on('connected')
def on_session_ready(data):
    """Handle session ready event."""
    print(f'\n✅ Session established: {data}')


@sio.on('disconnect')
def on_disconnect():
    """Handle disconnection event."""
    global connected
    connected = False
    print('\n❌ Disconnected from WebSocket server')


@sio.on('connect_error')
def on_connect_error(data):
    """Handle connection error."""
    print(f'\n❌ Connection error: {data}')


@sio.on('pong')
def on_pong(data):
    """Handle pong response."""
    print(f'\n✅ Pong received: {data}')


@sio.on('stream_started')
def on_stream_started(data):
    """Handle stream started event."""
    print(f'\n✅ Stream started: {data}')


@sio.on('stream_progress')
def on_stream_progress(data):
    """Handle stream progress event."""
    progress = data.get('progress', 0)
    status = data.get('status', 'unknown')
    print(f'📊 Progress: {progress}% - Status: {status}')


@sio.on('audio_chunk')
def on_audio_chunk(data):
    """Handle audio chunk event."""
    global chunks_received
    chunks_received += 1
    chunk_index = data.get('chunk_index', 0)
    total_chunks = data.get('total_chunks', 0)
    print(f'🎵 Received audio chunk {chunk_index + 1}/{total_chunks}')


@sio.on('stream_complete')
def on_stream_complete(data):
    """Handle stream complete event."""
    global stream_complete
    stream_complete = True
    print(f'\n✅ Stream complete: {data}')
    print(f'Total chunks received: {chunks_received}')


@sio.on('stream_error')
def on_stream_error(data):
    """Handle stream error event."""
    print(f'\n❌ Stream error: {data}')


def test_connection(url='http://localhost:8000'):
    """Test WebSocket connection."""
    print(f'🔌 Connecting to {url}...')
    
    try:
        # Connect to the server
        sio.connect(url, transports=['polling', 'websocket'])
        
        # Wait for connection
        timeout = 10
        start_time = time.time()
        while not connected and (time.time() - start_time) < timeout:
            time.sleep(0.1)
        
        if not connected:
            print('❌ Failed to connect within timeout')
            return False
        
        # Test ping/pong
        print('\n📡 Testing ping/pong...')
        sio.emit('ping', {'timestamp': time.time()})
        time.sleep(1)
        
        # Test TTS generation
        print('\n🎤 Testing TTS generation...')
        request_data = {
            'request_id': f'test_{int(time.time())}',
            'text': 'Hello, this is a WebSocket test!',
            'voice': 'alloy',
            'format': 'mp3',
            'chunk_size': 512
        }
        
        sio.emit('generate_stream', request_data)
        
        # Wait for stream to complete
        timeout = 30
        start_time = time.time()
        while not stream_complete and (time.time() - start_time) < timeout:
            time.sleep(0.1)
        
        if stream_complete:
            print('\n✅ WebSocket test completed successfully!')
            return True
        else:
            print('\n⚠️  Stream did not complete within timeout')
            return False
        
    except Exception as e:
        print(f'\n❌ Error during test: {e}')
        import traceback
        traceback.print_exc()
        return False
    
    finally:
        # Disconnect
        if connected:
            print('\n🔌 Disconnecting...')
            sio.disconnect()
            time.sleep(1)


if __name__ == '__main__':
    import sys
    
    # Get URL from command line or use default
    url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8000'
    
    print('=' * 60)
    print('TTSFM WebSocket Connection Test')
    print('=' * 60)
    
    success = test_connection(url)
    
    print('\n' + '=' * 60)
    if success:
        print('✅ All tests passed!')
        sys.exit(0)
    else:
        print('❌ Some tests failed')
        sys.exit(1)

