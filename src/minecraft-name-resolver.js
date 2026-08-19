const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class MinecraftNameResolver{
  constructor(fetcher=globalThis.fetch){this.fetcher=fetcher;this.cache=new Map();this.pending=new Map();}
  async resolve(uuid){
    if(!UUID.test(String(uuid||"")))return null;const key=uuid.toLowerCase(),cached=this.cache.get(key);if(cached&&cached.expires>Date.now())return cached.name;if(this.pending.has(key))return this.pending.get(key);
    const lookup=(async()=>{try{const response=await this.fetcher(`https://sessionserver.mojang.com/session/minecraft/profile/${key.replaceAll("-","")}`,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(4000)});if(!response.ok)return null;const value=await response.json(),name=typeof value.name==="string"&&/^[A-Za-z0-9_]{3,16}$/.test(value.name)?value.name:null;if(name)this.cache.set(key,{name,expires:Date.now()+21600000});return name;}catch{return null;}finally{this.pending.delete(key);}})();this.pending.set(key,lookup);return lookup;
  }
  async fill(known,uuids){const missing=[...new Set(uuids)].filter(uuid=>uuid&&!known.get(uuid));for(let offset=0;offset<missing.length;offset+=8)await Promise.all(missing.slice(offset,offset+8).map(async uuid=>{const name=await this.resolve(uuid);if(name)known.set(uuid,name);}));return known;}
}
