interface Scene {
    id: string
    title: string
    no: string
    type: string
    startTime: string
    endTime: string
    cerateTime: string
    description?:string
    platform: Platform[]
}
interface Platform {
     id: string
    name: string
}