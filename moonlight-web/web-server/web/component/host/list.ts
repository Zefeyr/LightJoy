import { DetailedHost, UndetailedHost } from "../../api_bindings.js"
import { Api, apiGetHosts } from "../../api.js"
import { ComponentEvent } from "../index.js"
import { Host, HostEventListener } from "./index.js"
import { FetchListComponent } from "../fetch_list.js"

export class HostList extends FetchListComponent<DetailedHost | UndetailedHost, Host> {
    private api: Api

    private eventTarget = new EventTarget()

    private emptyState: HTMLElement

    constructor(api: Api) {
        super({
            listClasses: ["host-list"],
            elementDivClasses: ["animated-list-element", "host-element"]
        })

        this.api = api

        // Empty State: Simple & Clean
        this.emptyState = document.createElement("div")
        this.emptyState.innerHTML = `
            <div style="font-size: 3rem; opacity: 0.2; margin-bottom: 10px;">🖥️</div>
            <h3 style="color: rgba(255,255,255,0.8); font-size: 1rem; margin: 0;">No Hosts Found</h3>
            <p style="color: rgba(255,255,255,0.4); font-size: 0.8rem;">Add a computer to start streaming</p>
        `
        this.emptyState.style.cssText = `
            width: 100%;
            text-align: center;
            padding: 40px;
            display: none;
            opacity: 0.7;
        `
    }

    async forceFetch() {
        const hosts = await apiGetHosts(this.api)
        this.updateCache(hosts)
    }

    updateCache(cache: (DetailedHost | UndetailedHost)[]) {
        super.updateCache(cache)
        this.updateUIState(cache.length)
    }

    private updateUIState(count: number) {
        // Ensure EmptyState is present and at the end
        const listEl = this.list.getListElement()

        if (!listEl.contains(this.emptyState)) {
            listEl.appendChild(this.emptyState)
        } else {
            listEl.appendChild(this.emptyState)
        }

        if (count > 0) {
            this.emptyState.style.display = "none"
        } else {
            this.emptyState.style.display = "block"
        }
    }

    protected updateComponentData(component: Host, data: DetailedHost | UndetailedHost): void {
        component.updateCache(data)
    }
    protected getComponentDataId(component: Host): number {
        return component.getHostId()
    }
    protected getDataId(data: DetailedHost | UndetailedHost): number {
        return data.host_id
    }

    public insertList(dataId: number, data: DetailedHost | UndetailedHost | null): void {
        const newHost = new Host(this.api, dataId, data)

        this.list.append(newHost)

        newHost.addHostRemoveListener(this.removeHostListener.bind(this))
        newHost.addHostOpenListener(this.onHostOpenEvent.bind(this))

        this.updateUIState(this.list.get().length)
    }
    public removeList(listIndex: number): void {
        const hostComponent = this.list.remove(listIndex)

        hostComponent?.addHostOpenListener(this.onHostOpenEvent.bind(this))
        hostComponent?.removeHostRemoveListener(this.removeHostListener.bind(this))
    }

    private removeHostListener(event: ComponentEvent<Host>) {
        const listIndex = this.list.get().findIndex(component => component.getHostId() == event.component.getHostId())

        this.removeList(listIndex)
        this.updateUIState(this.list.get().length)
    }

    getHost(hostId: number): Host | undefined {
        return this.list.get().find(host => host.getHostId() == hostId)
    }

    private onHostOpenEvent(event: ComponentEvent<Host>) {
        this.eventTarget.dispatchEvent(new ComponentEvent("ml-hostopen", event.component))
    }

    addHostOpenListener(listener: HostEventListener, options?: EventListenerOptions) {
        this.eventTarget.addEventListener("ml-hostopen", listener as EventListenerOrEventListenerObject, options)
    }
    removeHostOpenListener(listener: HostEventListener, options?: EventListenerOptions) {
        this.eventTarget.removeEventListener("ml-hostopen", listener as EventListenerOrEventListenerObject, options)
    }

    mount(parent: Element): void {
        this.list.mount(parent)
    }
    unmount(parent: Element): void {
        this.list.unmount(parent)
    }
}
