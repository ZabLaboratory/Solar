"""Actual CEF evidence of signed scene selection, two lanes and process recovery."""
import argparse, asyncio, base64, hashlib, io, json, os, subprocess, sys, time
from pathlib import Path
import urllib.parse, urllib.request
sys.dont_write_bytecode = True
from PIL import Image
from proof.pulsar_cef import Pulsar

p=argparse.ArgumentParser()
for name in ['pulsar','orion','source','output','query-gateway']:p.add_argument('--'+name,required=True)
p.add_argument('--local',default='http://127.0.0.1:8100')
a=p.parse_args();prefix=Path(a.output);prefix.parent.mkdir(parents=True,exist_ok=True)
source=Path(a.source);archive=source.with_suffix('.lsmlz')
before={str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in [source,archive]}
def local(path):
    with urllib.request.urlopen(a.local+path,timeout=5) as response:return json.load(response)
def pixel(image,x,y):return image.getpixel((x,y))[:3]
def colors(image):return len({pixel(image,x,y) for y in range(30,258,4) for x in range(30,444,4)})
runtime_root=Path(__file__).resolve().parent.parent
def artifacts():
    return {'host':{str(path.relative_to(runtime_root)):hashlib.sha256(path.read_bytes()).hexdigest() for path in (runtime_root/'dist/host').rglob('*') if path.is_file()},'vision':json.loads((runtime_root/'public/vision/vision-assets.json').read_text()),'native':json.loads((runtime_root/'dist/native/manifest.json').read_text()),'orionProgramSHA256':hashlib.sha256((Path(a.orion)/'internal/api/testdata/scene-lec-lck.program.json').read_bytes()).hexdigest()}
pulsar=Pulsar(a.pulsar,prefix);go=None;report={'result':'RUNNING','broadcast':False,'longSoak':'Pulsar stability accepted by user; new paths only','frames':[],'runtimeArtifacts':artifacts()}
async def capture(phase,input_name='PulsarSceneSource'):
    until=time.monotonic()+8
    while time.monotonic()<until:
        response=await pulsar.request('GetSourceScreenshot',{'sourceName':input_name,'imageFormat':'png','imageWidth':1920,'imageHeight':1080})
        data=base64.b64decode(response['imageData'].split(',',1)[-1]);image=Image.open(io.BytesIO(data)).convert('RGBA')
        if image.size==(1920,1080) and image.getchannel('A').getextrema()==(255,255) and pixel(image,500,100)==(43,42,42) and pixel(image,1700,700)==(0,0,0) and pixel(image,200,600)==(0,0,0) and colors(image)>80:
            path=Path(str(prefix)+'-'+phase+'.png');path.write_bytes(data)
            report['frames'].append({'phase':phase,'source':input_name,'path':str(path),'sha256':hashlib.sha256(data).hexdigest(),'cameraColors':colors(image),'staticGrey':pixel(image,500,100),'blackSurface':pixel(image,1700,700)})
            print('CEF_SCENE_CONTROL',phase,flush=True);return
        await asyncio.sleep(.1)
    raise RuntimeError('Complete scene missing: '+phase)
async def run():
    global go
    await pulsar.connect();health=local('/health')
    def url(resource):return a.local+'/host.html?'+urllib.parse.urlencode({'lsdp':health['native'],'resource':resource})
    await pulsar.show(url('solar/program'))
    current=await pulsar.request('GetCurrentProgramScene')
    await pulsar.request('CreateInput',{'sceneName':current['currentProgramSceneName'],'inputName':'SolarPreviewProof','inputKind':'browser_source','inputSettings':{'url':url('solar/preview'),'width':1920,'height':1080,'fps':60,'shutdown':False},'sceneItemEnabled':True})
    env={**os.environ,'GOTOOLCHAIN':'go1.26.6','ORION_TEST_SCENE_CONTROL_VISUAL':'1','ORION_TEST_LSDP_NATIVE_ADDRESS':health['nativeAddress'],'ORION_TEST_LSML_PATH':str(source),'ORION_TEST_QUERY_GATEWAY':a.query_gateway,'ORION_TEST_LOCAL_HTTP':a.local}
    log=Path(a.orion)/'evidence/local-20261005-coordinated-runtime/forge'/(prefix.name+'-orion-cef.log');log.parent.mkdir(parents=True,exist_ok=True)
    with log.open('w',encoding='utf-8') as output:
        go=subprocess.Popen(['go','test','-v','-count=1','-run','^TestRealNativeSceneControlVisual$','./internal/api'],cwd=a.orion,env=env,stdout=output,stderr=subprocess.STDOUT,creationflags=0x08000000)
        seen=set();until=time.monotonic()+115
        while time.monotonic()<until:
            for event in local('/health')['events']:
                if event.get('type')!='control-proof' or event['phase'] in seen:continue
                phase=event['phase'];seen.add(phase)
                if phase=='ready-for-crash':
                    pid=local('/health')['nativePid'];os.kill(pid,15);report['killedReceiverPid']=pid
                else:
                    await capture(phase,'SolarPreviewProof' if phase.startswith('preview-') else 'PulsarSceneSource')
                    state=local('/state?resource=orion/state')['state'];report.setdefault('observations',{})[phase]=state.get('scene_control',{}).get('defaults',{}).get('observed',{})
            if go.poll() is not None:break
            await asyncio.sleep(.12)
        if go.poll() is None:go.terminate();go.wait(10);raise RuntimeError('Orion CEF proof timed out')
    report['orionLog']=str(log)
    text=log.read_text(encoding='utf-8')
    if go.returncode or 'REAL_SCENE_CONTROL_PROOF PASS' not in text:raise RuntimeError('Orion proof failed: '+text[-2200:])
    report['commands']=[json.loads(line.split('REAL_OPERATOR_NATIVE_PROOF ',1)[1]) for line in text.splitlines() if 'REAL_OPERATOR_NATIVE_PROOF ' in line]
    if not report['commands'] or {item['lane'] for item in report['commands']}!={'program','preview'}:raise RuntimeError('No discovered command executions on both lanes')
    required={'program-active','preview-active','rollback','after-crash','orion-restart'}|{item['phase'] for item in report['commands']}
    if not required.issubset(seen):raise RuntimeError('Missing observed phases: '+str(required-seen))
    report['receiverPidAfterRecovery']=local('/health')['nativePid']
    if report['receiverPidAfterRecovery']==report['killedReceiverPid']:raise RuntimeError('Receiver not replaced')
    errors=[event for event in local('/health')['events'] if event.get('type')=='error']
    report['rendererErrors']=errors
    if any('SOURCE_REQUEST_FAILED' not in event.get('message','') and not (report.get('killedReceiverPid') and 'CONNECTION_LOST' in event.get('message','')) for event in errors):raise RuntimeError('Unexpected renderer error: '+str(errors))
    await pulsar.request('RemoveInput',{'inputName':'SolarPreviewProof'})
try:
    pulsar.start();asyncio.run(run())
    if artifacts()!=report['runtimeArtifacts']:raise RuntimeError('Runtime artifact changed during the CEF proof')
    report['result']='PASS'
except Exception as error:
    report['result']='FAIL';report['error']=str(error);raise
finally:
    if go and go.poll() is None:go.terminate();go.wait(10)
    pulsar.stop();report['sourceUnchanged']=all(hashlib.sha256(Path(path).read_bytes()).hexdigest()==digest for path,digest in before.items())
    report['pulsarReaped']=pulsar.process is None or pulsar.process.poll() is not None
    Path(str(prefix)+'-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
