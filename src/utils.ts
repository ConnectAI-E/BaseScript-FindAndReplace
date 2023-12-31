import { IFieldMeta, IOpenNumber, IOpenPhone, IOpenUrlSegment } from "@bitable/simple-api";
import { IWidgetField, bitable, IOpenCellValue, checkers, IOpenSegment, IOpenSingleCellValue, IOpenSegmentType, FieldType, IWidgetTable } from "@bitable/simple-api";
import { Toast } from '@douyinfe/semi-ui'









export interface ReplaceInfo {
  findCell: Cell,
  replaceBy: Cell,
  /**需要被替换的单值(匹配到的单值) */
  replaceSingleValue: IOpenSingleCellValue,
  /** 被替换后的单值 */
  newSingleValue: IOpenSingleCellValue,
  recordId: string,
  oldCellValue: IOpenCellValue, // (IFieldValue | IUndefinedFieldValue) 类型
}
/** 支持查找替换的字段类型 */
export enum SupportField {
  Text = FieldType.Text,
  Url = FieldType.Url,
  Phone = FieldType.Phone,
  Number = FieldType.Number
}
export interface ToSetList {
  value: IOpenCellValue,
  recordId: string,
  /** 复杂字段，发生了替换的属性键名和名称 */
  replaceKeys?: ReplaceKeys
}
export interface ReplaceInfos {
  /** 替换当前列所有需要替换的单元格 */
  replaceAll: () => Promise<any>;
  toSetList: ToSetList[];
  replaceInfo: ReplaceInfo[];
  field: IWidgetField,
  table: IWidgetTable,
  fieldMeta: IFieldMeta
}

export async function getFieldValueList(field: IWidgetField | undefined) {
  if (!field) {
    return null
  }
  const list = await field.getFieldValueList()
  return list
}
/** 查找的内容，不一定有text属性,这是根据字段类型的不同而不同 */
export interface Cell {
  text: string // 多行文本类型的一定有text属性，//TODO 已经允许批量替换 Cell中的key,但现在只支持字符串
  [p: string]: string | number,
  /** 为数字/字符串这种简单的单元格的值 */
  __value: number | string
}
interface ReplaceCellsProps {
  findCell: Cell,
  /** 将查找的内容替换成这个 */
  replaceBy: Cell
  /** 要在这一列中进行查找替换 */
  field: IWidgetField,
  table: IWidgetTable,
}
interface ReplaceKeys {
  key: string,
  label: string
}

export async function replaceCells({
  findCell,
  replaceBy,
  field,
  table,
}: ReplaceCellsProps): Promise<ReplaceInfos | undefined> {

  const fieldType: SupportField = (await field.getType()) as any;
  if (!Object.values(SupportField).includes(fieldType)) {
    return;
  }
  const fieldId = field.id;
  /** 找出支持查找替换的属性的描述 */
  const supportPropertyDesc = FiledTypesDesc[fieldType]
  if (!supportPropertyDesc) {
    return
  }
  const fieldValueList = await field.getFieldValueList()
  if (!fieldValueList) {
    return;
  }
  const fieldMeta = await field.getMeta()
  const singleCellDescArr = Object.values(supportPropertyDesc)

  const replaceInfo: ReplaceInfo[] = []
  /** 这些单元格需要被覆盖替换掉 */
  const toSetList: ToSetList[] = []
  fieldValueList.forEach((currentFieldValue) => {
    const { record_id, value } = currentFieldValue
    if (value !== null && value !== undefined) {
      if (checkers.isNumber(value)) {
        //单元格是数字类型
        const strValue = String(value)
        const fd = String(findCell.__value)
        const rep = replaceBy.__value === undefined ? '' : String(replaceBy.__value);
        const isNumber = /^[0-9]+(\.[0-9]+)?$/
        if (strValue.includes(fd)) {
          let newValue: string | number | null = strValue.replaceAll(fd, rep)
          if ((!isNumber.test(newValue) && newValue !== '') ||
            newValue === strValue) {
            return;
          }
          if (newValue.length) {
            newValue = +newValue
          } else {
            newValue = null
          }
          toSetList.push({
            value: newValue,
            recordId: record_id
          })
          replaceInfo.push({
            findCell,
            replaceBy,
            recordId: record_id,
            replaceSingleValue: value,
            newSingleValue: newValue as any,
            oldCellValue: value,
          })
        }
        return;
      }
      if (checkers.isPhone(value)) {
        //单元格是电话号码类型
        const fd = String(findCell.__value)
        const rep = replaceBy.__value === undefined ? '' : String(replaceBy.__value)
        const isNumber = /^\+?\d{0,19}$/
        let newValue: string | number | null = value.replaceAll(fd, rep)
        if (!isNumber.test(newValue)) {
          return
        }
        if (value.includes(fd)) {
          if (newValue.length > 20 || newValue === value) {
            return;
          }
          if (newValue === '') {
            newValue = null
          }
          toSetList.push({
            value: newValue,
            recordId: record_id
          })
          replaceInfo.push({
            findCell,
            replaceBy,
            recordId: record_id,
            replaceSingleValue: value,
            newSingleValue: newValue as any,
            oldCellValue: value,
          })
        }
        return;
      }
      // 
      if (checkers.isSegments(value)) {
        // 多行文本和链接类型的单元格
        // link 和text是多行文本下4中类型的情况可能出现的替换的值
        let cellNeedToReplace = false;
        const replaceKeys: ReplaceKeys[] = []
        /** 有可能将替换掉旧的cellValue */
        let newValue = value.map((v) => {
          // 找出当前的值的最终类型描述
          const singleCellDesc = singleCellDescArr.find((desc) => { return desc.filters(v) });
          if (!singleCellDesc) {
            return v;
          }
          const { actionKeys } = singleCellDesc
          /** 新的单元格的单值 */
          let newSingleValue = { ...v } // 修改了它就需要将cellNeedToReplace设置为true
          /** 单值是否发生了替换（不包含删除） */
          let singleValueReplaced = false
          for (const iterator of actionKeys!) {
            // 遍历允许被替换的key，并找出当前的key允许的操作，如果存在替换，则尝试替换/删除
            const { key, actions } = iterator;
            let currentCellKeyValue: string | null = (v as any)[key] // TODO 需要保证这里的v【key】为string类型，否则需要另作处理
            if (typeof currentCellKeyValue === 'string') {
              if (findCell[key] && currentCellKeyValue.includes(String(findCell[key]))) {
                if (actions === 'replace' || !actions) {
                  currentCellKeyValue = currentCellKeyValue.replaceAll(String(findCell[key]), String(replaceBy[key]) || '') || null;
                  (newSingleValue as any)[key] = currentCellKeyValue
                  replaceKeys.push({
                    key: iterator.key,
                    label: iterator.label
                  })
                  cellNeedToReplace = true;
                  singleValueReplaced = true;
                }
              }
            }
          }
          if (singleValueReplaced) {
            // console.log('匹配到发生替换的单值', {
            //     '1匹配字段和条件：': findCell,
            //     '2试图替换为：': replaceBy,
            //     '3需要被替换的单值(匹配到的单值)：': v,
            //     '4被替换后的单值：': newSingleValue,
            //     '5被替换的单值所在单元格和recordId:': currentFieldValue,
            // });
            replaceInfo.push({
              findCell,
              replaceBy,
              replaceSingleValue: v,
              recordId: record_id!,
              newSingleValue: newSingleValue,
              oldCellValue: currentFieldValue.value,
            });
          }
          return newSingleValue
        }).filter((v) => Boolean(v)).filter((v) => v.text !== null)
        if (newValue.length === 0) {
          newValue = null as any
        }
        if (cellNeedToReplace) {
          toSetList.push({ value: newValue, recordId: record_id, replaceKeys } as any)
        }
        return;
      }
    }
  })
  const replaceAll = async () => {
    const res = await Promise.allSettled(toSetList.map(({ value, recordId }) => {
      return table.setCellValue(fieldId, recordId, value).then(() => {
        return {
          success: true,
          fieldIdRecordId: fieldId + ';' + recordId
        };
      }).catch((e) => {
        Toast.error(`设置单元格失败:${e}`);
        console.error('设置值报错：', fieldId, recordId, value);
        return Promise.reject({
          success: false,
          fieldIdRecordId: fieldId + ';' + recordId
        });
      });
    }));
    let success = res.filter((v) => v.status === 'fulfilled');
    let failed = res.filter((v) => v.status === 'rejected')
    return {
      success,
      failed
    }

  }
  // replaceAll();

  return {
    replaceAll,
    toSetList,
    replaceInfo,
    field,
    table,
    fieldMeta
  }
}


//有多个类型的字段，一个字段中又有多个子类型,选中了一个字段之后，还需要再选中这个字段中哪些子类型可以被查找替换,这是这些字段类型，及其单元格可以设置的值类型的表述
/** 支持查找替换的单元格类型,首先支持多行文本类型的单元格 */
export const FiledTypesDesc: Record<SupportField, FieldTypeDesc> = {
  // IOpenTextSegment | IOpenUrlSegment | IOpenUserMentionSegment | IOpenDocumentMentionSegment

  /** 多行文本类型的fileld的type，多行文本类型的单元格有4种单值类型 */
  [FieldType.Text]: {
    'IOpenTextSegment': {
      label: '普通文本',
      default: true,
      actionKeys: [{
        key: 'text',
        label: '普通文本',
        actions: 'replace'
      }],
      type: 'IOpenTextSegment',
      filters: (value: IOpenSegment) => {
        return Boolean(value?.type === IOpenSegmentType.Text)
      }
    },
    'IOpenUrlSegment': {
      label: '链接类型',
      default: true,
      type: "IOpenUrlSegment",
      actionKeys: [{ key: 'text', label: '链接的文本', actions: 'replace' }, { key: 'link', label: '链接', actions: 'replace' }],
      filters: (value: IOpenSegment) => {
        return Boolean(value?.type === IOpenSegmentType.Url)
      }
    },
  },
  [FieldType.Url]: {
    'IOpenUrlSegment': {
      label: '链接',
      default: true,
      type: 'IOpenUrlSegment',
      actionKeys: [{ key: 'text', label: '链接的文本', actions: 'replace' }, { key: 'link', label: '链接', actions: 'replace' }],
      filters: (value: IOpenUrlSegment) => {
        return Boolean(value.type === IOpenSegmentType.Url)
      }
    }
  },
  // [FieldType.User]: {
  //     'IOpenUser': {
  //         label: '人员',
  //         default: true,
  //         type: 'IOpenUser',
  //         actionKeys:
  //     }
  // }
  [FieldType.Phone]: {
    'IOpenPhone': {
      label: '电话号码',
      default: true,
      type: "IOpenPhone",
      filters: (v: IOpenPhone) => {
        return typeof v === 'string'
      }
    }
  },
  [FieldType.Number]: {
    'IOpenNumber': {
      label: '数字',
      default: true,
      type: 'IOpenNumber',
      filters: (v: IOpenNumber) => {
        return typeof v === 'number'
      }
    }
  }
}


/** 单元格类型及其子类型单值的类型、允许的操作描述 */
interface FieldTypeDesc {
  [p: string]: {
    label: string,
    type: string,
    /** 默认查找这种单值类型 */
    default?: boolean
    /**这些key将会参与查找替换,用于复杂单元格， */
    actionKeys?: {
      label: string,
      key: string,
      /** delete：只能删除这个单元格单值，replace：可以删除这个单元格单值，以及替换key的值 */
      actions?: ('delete' | 'replace')
    }[],
    /** 传单值（一个单元格的值可能是由多种单值混合而成的数组），return true的时候表示匹配上了这个单元格类型的单值 */
    filters: (value: any) => boolean
  }

}
