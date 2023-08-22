import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Room } from '@prisma/client';
import uniq from 'lodash/uniq';
import { customAlphabet } from 'nanoid';

import { PrismaService } from '@/prisma/prisma.service';

import { CreateRoomDto } from './dto/create-room.dto';

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890', 6);

@Injectable()
export class RoomsService {
  constructor(private readonly prismaService: PrismaService) {}

  private convertStringToDate(stringDate: string): Date {
    return new Date(stringDate);
  }

  async getRoomInfo(code: string): Promise<boolean> {
    const roomInfo = await this.prismaService.room.findUnique({
      where: { code },
    });
    //만약 방이 없다면 예외처리를 어떻게 해야 할까요??
    const dateOnly = roomInfo.dateOnly;
    return dateOnly;
  }

  /**
   * 이 부분 상세 조건들은 아래 슬랙을 참고하시면 좋습니다
   * @see {@link https://www.notion.so/likelion-11th/6-6-8fdfd4c7268e4f70bd232dcee5078aab?pvs=4#ca12b4cd60904410bbb83549e748f1cd | Notion}
   */
  async create(createRoomDto: CreateRoomDto): Promise<Room> {
    this.validateDates(createRoomDto);

    return this.prismaService.room.create({
      data: {
        code: nanoid(),
        ...createRoomDto,
        dateOnly: createRoomDto.dateOnly || false,
      },
    });
  }

  async findOne(code: string): Promise<Room> {
    const room = this.prismaService.room.findUnique({
      where: { code },
    });

    if (!room) {
      throw new NotFoundException(`Room with code ${code} not found`);
    }

    return room;
  }

  async getRoomResult(code: string) {
    const room = await this.prismaService.room.findUnique({
      where: { code },
      include: {
        users: {
          select: {
            enableTimes: true,
          },
        },
      },
    });

    if (!room) {
      throw new NotFoundException(`Room with code ${code} not found`);
    }

    let enableTimesList: string[];

    if (room.dateOnly) {
      enableTimesList = room.users
        .map(user => user.enableTimes)
        .flat()
        .sort();
    } else {
      enableTimesList = room.users
        .map(user => uniq(user.enableTimes.map(time => time.split(' ')[0])))
        .flat()
        .map(time => time.split(' ')[0])
        .sort();
    }

    const timeMap = new Map();
    enableTimesList.forEach(time => {
      if (timeMap.has(time)) {
        timeMap.set(time, timeMap.get(time) + 1);
      } else {
        timeMap.set(time, 1);
      }
    });
    const enableTimes = Object.fromEntries(timeMap.entries());

    delete room.users;

    return {
      ...room,
      enableTimes,
    };
  }

  validateDates(createRoomDto: CreateRoomDto) {
    const errors = [];

    const dates = createRoomDto.dates;
    const firstDate = this.convertStringToDate(dates[0]);
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
    const koreaTimeDiff = 9 * 60 * 60 * 1000;
    const nowKoreanDate = new Date(utc + koreaTimeDiff);

    const maxDate = new Date(
      nowKoreanDate.setMonth(nowKoreanDate.getMonth() + 6)
    );
    const maxDateString = `${maxDate.getFullYear()}-${(
      '0' +
      (maxDate.getMonth() + 1)
    ).slice(-2)}-${('0' + maxDate.getDate()).slice(-2)}`;

    if (dates.length < 1 || dates.length > 60) {
      errors.push('dates must be between 1 and 60');
    }

    const uniqueDates = new Set(dates);
    if (dates.length !== uniqueDates.size) {
      errors.push('dates must be unique');
    }

    const sortedDates = [...dates].sort();
    if (dates.join(',') !== sortedDates.join(',')) {
      errors.push('dates must be sorted');
    }

    if (
      firstDate.getMonth() < nowKoreanDate.getMonth() ||
      firstDate.getDate() < nowKoreanDate.getDate()
    ) {
      errors.push('first date must be today no matter how early it is.');
    }

    if (sortedDates.at(-1) > maxDateString) {
      errors.push('dates must be within 6 months');
    }

    if (
      !createRoomDto.dateOnly &&
      (!createRoomDto.startTime || !createRoomDto.endTime)
    ) {
      errors.push('startTime and endTime are required when dateOnly is false');
    }

    if (
      createRoomDto.dateOnly &&
      (createRoomDto.startTime || createRoomDto.endTime)
    ) {
      errors.push(
        'startTime and endTime are not allowed when dateOnly is true'
      );
    }

    if (
      createRoomDto.startTime &&
      createRoomDto.endTime &&
      createRoomDto.startTime > createRoomDto.endTime
    ) {
      errors.push('startTime must be earlier than endTime');
    }

    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }
  }
}
