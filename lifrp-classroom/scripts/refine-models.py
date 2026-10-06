import bpy
import math
import json
import struct
from pathlib import Path
from collections import defaultdict
from mathutils import Vector
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'public/assets/models/source'
OUT = ROOT / 'assets/refined'


def material(name, color):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = .85
    return mat


def box(name, xyz, size, mat, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new('Soft_edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def uv_project(obj):
    uv = obj.data.uv_layers.active or obj.data.uv_layers.new(name='UVMap')
    for poly in obj.data.polygons:
        axis = max(range(3), key=lambda i: abs(poly.normal[i]))
        a, b = [(1, 2), (0, 2), (0, 1)][axis]
        for index in poly.loop_indices:
            co = obj.data.vertices[obj.data.loops[index].vertex_index].co
            uv.data[index].uv = (co[a] * .7, co[b] * .7)


def texture_material(mat, style, tier):
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if not bsdf:
        return
    size = 256 if tier == 'desktop' else 128
    seed = sum(ord(c) for c in mat.name)
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[:size, :size]
    noise = rng.random((size, size)) * .075
    if style == 'wood':
        grain = .84 + .1 * np.sin(xx * .4 + np.sin(yy * .02) * 4) + noise
    elif style == 'floor':
        line = (xx % (size // 4) < 1) | (yy % (size // 4) < 1)
        grain = np.where(line, .51, .88) + noise
    else:
        grain = .86 + noise + .03 * np.sin(yy * .06)
    base = np.array(bsdf.inputs['Base Color'].default_value[:3])
    pixels = np.ones((size, size, 4), dtype=np.float32)
    pixels[:, :, :3] = np.clip(base[None, None, :] * grain[:, :, None], 0, 1)
    image = bpy.data.images.new('Baked_' + mat.name, width=size, height=size, alpha=True)
    image.pixels.foreach_set(pixels.ravel())
    image.pack()
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = image
    node.extension = 'REPEAT'
    mat.node_tree.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)


def text_mesh(name, content, position, size, mat):
    curve = bpy.data.curves.new(name, 'FONT')
    curve.body = content
    curve.size = size
    curve.extrude = .0005
    curve.resolution_u = 2
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.location = position
    obj.rotation_euler = (math.pi / 2, 0, 0)
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj.select_set(False)
    return obj


def reset():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for group in [bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.curves]:
        for item in list(group):
            if item.users == 0:
                group.remove(item)


def refine(name, tier):
    reset()
    bpy.ops.import_scene.gltf(filepath=str(SOURCE / (name + '.glb')))
    mesh_objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    desktop = tier == 'desktop'
    for obj in mesh_objects:
        if not obj.data.materials:
            obj.data.materials.append(material('Fallback_Wall', (.4, .43, .46)))
        if obj.name.endswith('_Top') or (desktop and any(k in obj.name for k in ['Frame', 'Desk_Base'])):
            bpy.context.view_layer.objects.active = obj
            mod = obj.modifiers.new('Edge_refinement', 'BEVEL')
            mod.width = .009 if desktop else .006
            mod.segments = 2 if desktop else 1
            mod.limit_method = 'ANGLE'
            bpy.ops.object.modifier_apply(modifier=mod.name)
        uv_project(obj)
    for mat in list(bpy.data.materials):
        if not mat.use_nodes:
            mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            bsdf.inputs['Roughness'].default_value = .86 if 'Metal' not in mat.name else .55
            if 'Wall_White' in mat.name:
                bsdf.inputs['Base Color'].default_value = (.6, .66, .65, 1)
            if 'Student_Desk_Blue' in mat.name:
                bsdf.inputs['Base Color'].default_value = (.06, .24, .32, 1)
            if 'Wood' in mat.name:
                bsdf.inputs['Base Color'].default_value = (.31, .19, .12, 1)
            if 'Glass' in mat.name:
                bsdf.inputs['Alpha'].default_value = .22
        if 'Wood' in mat.name:
            texture_material(mat, 'wood', tier)
        elif 'Floor' in mat.name:
            texture_material(mat, 'floor', tier)
        elif 'Wall_White' in mat.name:
            texture_material(mat, 'wall', tier)
    paper = material('Props_Paper', (.65, .62, .51))
    cover = material('Props_Oxblood', (.21, .075, .065))
    pencil = material('Props_Pencil', (.12, .09, .055))
    chalk = material('Props_Chalk', (.63, .72, .65))
    if name == 'classroom':
        tops = sorted([o for o in mesh_objects if 'CLS_Desk_' in o.name and o.name.endswith('_Top')], key=lambda o:o.name)
        for i, obj in enumerate(tops):
            if i % (3 if desktop else 9):
                continue
            corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
            center = sum(corners, Vector()) / 8
            top = max(v.z for v in corners)
            x, y = center.x, center.y
            box('BookCover', (x, y, top + .025), (.24, .32, .04), cover, .004)
            box('BookPages', (x, y, top + .047), (.227, .302, .018), paper)
            if desktop:
                pen = box('Pencil', (x + .2, y, top + .009), (.012, .25, .012), pencil)
                pen.rotation_euler.z = .12
        bpy.ops.object.select_all(action='DESELECT')
        text_mesh('Chalkboard_Writing', 'CHEMISTRY  /  LiFrP\n\n2H2 + O2  ->  2H2O\n\nOBSERVE.  REASON.  VERIFY.', (-3.7, 3.975, 2.35), .16, chalk)
        box('Chalk_Ledge', (-2.5, 3.88, .95), (2.6, .12, .04), pencil, .004)
        for i in range(4 if desktop else 2):
            box('Chalk', (-3 + i * .15, 3.85, .982), (.1, .018, .018), chalk)
    elif name == 'office':
        tops = [o for o in mesh_objects if 'Top' in o.name and ('Desk' in o.name or 'Work' in o.name)]
        for obj in tops[:6 if desktop else 3]:
            corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
            center = sum(corners, Vector()) / 8
            box('Grading_Pile', (center.x, center.y, max(v.z for v in corners) + .045), (.32, .25, .09), paper, .005)
    elif name == 'corridor':
        bpy.ops.object.select_all(action='DESELECT')
        text_mesh('Room_Direction', 'CLASSROOM   <     >   OFFICE', (-3.7, 1.34, 2.42), .2, chalk)
    groups = defaultdict(list)
    for obj in list(bpy.context.scene.objects):
        if obj.type != 'MESH':
            continue
        cut = 'Ceiling' if ('Ceiling' in obj.name or 'Roof' in obj.name) else 'Cutaway' if any(k in obj.name for k in ['Wall', 'Window', 'Curtain', 'InnerTop', 'InnerLower']) else 'Static'
        mat = obj.data.materials[0] if obj.data.materials else paper
        groups[(cut, mat.name)].append(obj)
    for (cut, mat), objects in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        if len(objects) > 1:
            bpy.ops.object.join()
        result = bpy.context.object
        result.name = cut + '_' + mat
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for obj in list(bpy.context.scene.objects):
        if obj.type == 'MESH' and not obj.data.uv_layers:
            uv_project(obj)
    dest = OUT / tier / (name + '.glb')
    dest.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(dest), export_format='GLB', export_yup=True, export_apply=True, export_animations=False, export_cameras=False, export_lights=False, export_texcoords=True, export_normals=True)
    blob = dest.read_bytes()
    length = struct.unpack_from('<I', blob, 12)[0]
    g = json.loads(blob[20:20+length])
    tris = sum(g['accessors'][p['indices']]['count'] // 3 for m in g['meshes'] for p in m['primitives'] if p.get('mode', 4) == 4)
    record = {'tier': tier, 'name': name, 'bytes': len(blob), 'meshes': len(g['meshes']), 'triangles': tris, 'materials': len(g.get('materials', [])), 'images': len(g.get('images', []))}
    print('REFINED', json.dumps(record), flush=True)
    return record


records = []
for tier in ['desktop', 'mobile']:
    for name in ['classroom', 'corridor', 'office', 'exterior_block']:
        records.append(refine(name, tier))
print('REFINEMENT_COMPLETE', json.dumps(records), flush=True)
